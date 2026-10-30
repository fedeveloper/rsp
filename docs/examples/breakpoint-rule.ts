// The example rule of docs/WRITING-RULES.md. It is not registered in
// src/rules/index.ts; test/docs-example.test.ts runs it so the guide stays true.
import { stringLines } from "../../src/rules/python.js";
import { codeSpan } from "../../src/text.js";
import type { RawFinding, Rule } from "../../src/types.js";

const BREAKPOINT = /(^|[^\w.])(breakpoint\s*\(\s*\)|pdb\.set_trace\s*\(\s*\))/;

export const debugBreakpoint: Rule = {
  id: "debug/breakpoint",
  version: "0.1.0",
  keys: "`breakpoint` or `pdb`",
  knownKeys: ["breakpoint", "pdb"],
  description: "Python breakpoint() and pdb.set_trace() calls added by the diff.",
  run(ctx) {
    const findings: RawFinding[] = [];
    for (const file of ctx.files) {
      // Diff-scoped: only text files that still exist, and only their added lines.
      if (file.binary || file.status === "deleted" || !file.path.endsWith(".py")) continue;
      // Precision: a call written inside a string (a docstring, generated code) is text, not code.
      const inStrings = stringLines(ctx.readHead(file.path) ?? "");
      for (const line of file.lines) {
        if (line.kind !== "add" || inStrings.has(line.newLine!)) continue;
        const code = line.text.replace(/#.*$/, "");
        const m = BREAKPOINT.exec(code);
        if (!m) continue;
        const call = m[2]!.replace(/\s+/g, "");
        findings.push({
          key: call.startsWith("pdb") ? "pdb" : "breakpoint",
          // A fact, not advice, and diff text only inside a code span.
          message: `Added ${codeSpan(call)} call`,
          locations: [{ path: file.path, line: line.newLine }],
          evidence: line.text.trim(),
        });
      }
    }
    return findings;
  },
};
