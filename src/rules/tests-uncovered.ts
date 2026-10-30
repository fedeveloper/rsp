import type { RawFinding, Rule } from "../types.js";
import { codeSpan } from "../text.js";

// Some tools, such as Node's own coverage of TypeScript through source maps, give comments and type-only
// declarations a count of zero; no code on these lines can run.
const NEVER_RUNS = /^(#|\/\/|\/\*|\*|$)|^(export\s+)?(declare\s+|interface\s|type\s+[\w$]+\s*(<.*>)?\s*=|import\s+type\b)/;

export const testsUncovered: Rule = {
  id: "tests/uncovered-change",
  version: "0.1.0",
  keys: "the file path, e.g. `src/billing.py`",
  description:
    "Added lines that the coverage report of the tests at head measures and that did not run, counted per file: " +
    "one fact per file. Runs only when coverage reports are given (LCOV or Cobertura).",
  run(ctx) {
    if (!ctx.coverage) return [];
    // Lines moved from elsewhere in the diff are not new code: whether they ran before is not known here.
    const deleted = new Set(ctx.files.flatMap((f) => f.lines.filter((l) => l.kind === "del").map((l) => l.text.trim())));
    const findings: RawFinding[] = [];
    for (const file of ctx.files) {
      if (file.binary || file.status === "deleted") continue;
      const hits = ctx.coverage.get(file.path);
      if (!hits) continue;
      // Only lines the report measures: comments, blank lines and declarations have no entry.
      const measured = file.lines.filter((l) => l.kind === "add" && hits.has(l.newLine!) && !deleted.has(l.text.trim()) && !NEVER_RUNS.test(l.text.trim()));
      const missed = measured.filter((l) => hits.get(l.newLine!) === 0);
      if (missed.length === 0) continue;
      findings.push({
        key: file.path,
        message: `${missed.length} of the ${measured.length} added ${measured.length === 1 ? "line" : "lines"} of ${codeSpan(file.path)} that the coverage report measures did not run in the tests at head`,
        locations: [{ path: file.path, line: missed[0]!.newLine }],
        evidence: missed[0]!.text.trim(),
      });
    }
    return findings;
  },
};
