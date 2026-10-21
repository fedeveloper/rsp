import type { RawFinding, Rule } from "../types.js";
import { envVarReads } from "./python.js";

const EXAMPLE_FILE = /(^|\/)(\.env[._-](example|sample|template|dist|defaults)|env\.example|example\.env|sample\.env)$/i;
const EXAMPLE_KEY = /^\s*#?\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

// Set by the OS, the shell, Python or CI; nobody documents them in an example file.
const STANDARD = new Set([
  "CI", "HOME", "HOSTNAME", "LANG", "LANGUAGE", "LOGNAME", "PATH", "PWD", "PYTHONHASHSEED",
  "PYTHONPATH", "SHELL", "TEMP", "TERM", "TMP", "TMPDIR", "TZ", "USER", "VIRTUAL_ENV",
]);
const STANDARD_PREFIXES = ["GITHUB_", "RUNNER_", "LC_"];

export const envMissingExample: Rule = {
  id: "env/missing-example",
  version: "0.1.0",
  description: "Environment variables read in added Python code but missing from the example env file.",
  run(ctx) {
    const pyFiles = ctx.files.filter((f) => !f.binary && f.status !== "deleted" && f.path.endsWith(".py"));
    if (pyFiles.length === 0) return [];
    const examples = ctx.listHead().filter((p) => EXAMPLE_FILE.test(p));
    // No example file means the repository has no such convention to keep up.
    if (examples.length === 0) return [];

    const documented = new Set<string>();
    for (const path of examples) {
      for (const line of (ctx.readHead(path) ?? "").split("\n")) {
        const m = EXAMPLE_KEY.exec(line);
        if (m) documented.add(m[1]!);
      }
    }
    // A read that was only moved from elsewhere in the diff is not new.
    const removedReads = new Set(
      ctx.files.flatMap((f) => f.lines.filter((l) => l.kind === "del").flatMap((l) => envVarReads(l.text))),
    );

    const findings: RawFinding[] = [];
    for (const file of pyFiles) {
      for (const l of file.lines) {
        if (l.kind !== "add") continue;
        for (const name of new Set(envVarReads(l.text))) {
          if (documented.has(name) || removedReads.has(name) || isStandard(name)) continue;
          findings.push({
            message: `Reads environment variable \`${name}\`, missing from ${examples.join(", ")}`,
            locations: [{ path: file.path, line: l.newLine }],
            evidence: l.text.trim(),
          });
        }
      }
    }
    return findings;
  },
};

function isStandard(name: string): boolean {
  return STANDARD.has(name) || STANDARD_PREFIXES.some((p) => name.startsWith(p));
}
