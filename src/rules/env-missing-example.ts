import type { RawFinding, Rule } from "../types.js";
import * as js from "./js.js";
import * as python from "./python.js";

const EXAMPLE_FILE = /(^|\/)(\.env(\.[\w-]+)*[._-](example|sample|template|dist|defaults)|env\.example|example\.env|sample\.env)$/i;
const EXAMPLE_KEY = /^\s*#?\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

// Set by the OS, the shell, Python, Node or CI; nobody documents them in an example file.
const STANDARD = new Set([
  "CI", "DEBUG", "FORCE_COLOR", "HOME", "HOSTNAME", "LANG", "LANGUAGE", "LOGNAME", "NO_COLOR",
  "NODE_DEBUG", "NODE_ENV", "NODE_EXTRA_CA_CERTS", "NODE_OPTIONS", "NODE_TLS_REJECT_UNAUTHORIZED",
  "PATH", "PWD", "PYTHONHASHSEED", "PYTHONPATH", "SHELL", "TEMP", "TERM", "TMP", "TMPDIR", "TZ",
  "USER", "VIRTUAL_ENV",
]);
const STANDARD_PREFIXES = ["GITHUB_", "RUNNER_", "LC_", "npm_"];

export const envMissingExample: Rule = {
  id: "env/missing-example",
  version: "0.2.0",
  description:
    "Environment variables read in added Python or JavaScript/TypeScript code but missing from the example env file.",
  run(ctx) {
    const sources = ctx.files.filter((f) => !f.binary && f.status !== "deleted" && envReader(f.path));
    if (sources.length === 0) return [];
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
    const where = examples.length <= 3 ? examples.join(", ") : `any of ${examples.length} example env files`;
    // A read that was only moved from elsewhere in the diff is not new.
    const removedReads = new Set(
      ctx.files.flatMap((f) => {
        const read = envReader(f.oldPath);
        return read ? f.lines.filter((l) => l.kind === "del").flatMap((l) => read(l.text)) : [];
      }),
    );

    const findings: RawFinding[] = [];
    for (const file of sources) {
      const read = envReader(file.path)!;
      // Code embedded in a JavaScript template literal is not read by this file.
      const nonCode = js.JS_FILE.test(file.path) ? js.nonCodeLines(ctx.readHead(file.path) ?? "") : new Set<number>();
      for (const l of file.lines) {
        if (l.kind !== "add" || nonCode.has(l.newLine!)) continue;
        for (const name of new Set(read(l.text))) {
          if (documented.has(name) || removedReads.has(name) || isStandard(name)) continue;
          findings.push({
            message: `Reads environment variable \`${name}\`, missing from ${where}`,
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

function envReader(path: string): ((line: string) => string[]) | undefined {
  if (path.endsWith(".py")) return python.envVarReads;
  if (js.JS_FILE.test(path)) return js.envVarReads;
  return undefined;
}
