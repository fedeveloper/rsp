// Runs every rule on the latest first-parent commits of real repositories,
// each compared with its first parent, and writes a report of all findings for
// manual review. Usage:
//   node --import tsx eval/real-history.ts --commits 100 --out eval/REAL_HISTORY.md <repo-dir>...
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { check } from "../src/index.js";
import { ALL_RULES } from "../src/rules/index.js";
import type { Finding } from "../src/types.js";
import { VERSION } from "../src/version.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { commits: { type: "string", default: "100" }, out: { type: "string" } },
});

const git = (dir: string, args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

interface Hit {
  sha: string;
  subject: string;
  finding: Finding;
  verified: string;
}

/** Occurrences of an exact line across all files of a commit. */
function countLine(dir: string, commit: string, line: string): number {
  let files: string[];
  try {
    const out = execFileSync("git", ["-C", dir, "grep", "-l", "-F", "-e", line.trim(), commit], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    files = out.trim().split("\n").map((l) => l.slice(commit.length + 1));
  } catch {
    return 0; // git grep exits 1 when nothing matches
  }
  let n = 0;
  for (const file of files) {
    const text = execFileSync("git", ["-C", dir, "show", `${commit}:${file}`], { encoding: "utf8" });
    n += text.split("\n").filter((l) => l === line).length;
  }
  return n;
}

/**
 * Independent checks of a finding against git itself: the reported line holds
 * the evidence, and an "Added" line occurs more often at head than at base.
 */
function verify(dir: string, base: string, head: string, f: Finding): string {
  const loc = f.locations[0];
  if (f.ruleId === "deps/lockfile") return verifyLockfile(dir, base, head, f);
  if (!loc?.line) return "n/a";
  const text = execFileSync("git", ["-C", dir, "show", `${head}:${loc.path}`], { encoding: "utf8" }).split("\n")[loc.line - 1];
  if (text?.trim() !== f.evidence) return "WRONG LINE";
  if (f.message.startsWith("Parameters")) return verifySignature(dir, base, head, f);
  if (!f.message.startsWith("Added") && !f.message.startsWith("Imports") && !f.message.startsWith("Reads")) return "line ok";
  const before = countLine(dir, base, text);
  const after = countLine(dir, head, text);
  return after > before ? `new line (${before} -> ${after})` : `NOT NEW (${before} -> ${after})`;
}

/**
 * For a lockfile finding: the manifest line holds the evidence (or, for a
 * removal, the base manifest did), and the package name occurs in the lockfile
 * at head (for "still lists it") or not at all, or the lockfile did not change
 * in the commit (for "does not list it" and "records").
 */
function verifyLockfile(dir: string, base: string, head: string, f: Finding): string {
  const [manifest, lock] = f.locations;
  if (!manifest || !lock) return "NO LOCKFILE";
  const show = (commit: string, path: string) => execFileSync("git", ["-C", dir, "show", `${commit}:${path}`], { encoding: "utf8" });
  const lines = show(f.message.startsWith("Removes") ? base : head, manifest.path).split("\n").map((l) => l.trim());
  if (manifest.line ? lines[manifest.line - 1] !== f.evidence : !lines.includes(f.evidence)) return "WRONG LINE";
  const unchanged = execFileSync("git", ["-C", dir, "diff", "--name-only", base, head, "--", lock.path], { encoding: "utf8" }).trim() === "";
  const name = /`([^`]+)`/.exec(f.message)![1]!;
  const mentioned = new RegExp(`["'/\\s]${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'@:\\s]`, "i").test(show(head, lock.path));
  if (f.message.startsWith("Removes")) return mentioned ? "name still in lockfile" : "NAME NOT IN LOCKFILE";
  if (unchanged) return "lockfile unchanged";
  return mentioned ? "CHECK: lockfile changed and mentions the name" : "name not in lockfile";
}

/**
 * For a parameter change: the reported line defines the function, and its
 * definition text, up to the closing parenthesis, does not occur in the base file.
 */
function verifySignature(dir: string, base: string, head: string, f: Finding): string {
  const loc = f.locations[0]!;
  const lines = execFileSync("git", ["-C", dir, "show", `${head}:${loc.path}`], { encoding: "utf8" }).split("\n");
  const name = /`([^`]+)`/.exec(f.message)![1]!.split(".").pop()!;
  const first = lines[loc.line! - 1]!;
  if (!first.includes(name === "__init__" ? "__init__" : name)) return "NOT A DEFINITION";
  const def: string[] = [];
  for (let i = loc.line! - 1; i < lines.length && def.length < 60; i++) {
    def.push(lines[i]!.trim());
    if (/\)\s*(->.*)?:\s*(#.*)?$|\)\s*(:[^=]*)?(=>|\{)/.test(lines[i]!)) break;
  }
  const baseText = execFileSync("git", ["-C", dir, "show", `${base}:${loc.path}`], { encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .join("\n");
  return baseText.includes(def.join("\n")) ? "SAME AT BASE" : "definition changed";
}

const lines: string[] = [
  "# Findings on real repository history",
  "",
  `Generated by \`eval/real-history.ts\` with rsp ${VERSION}. Each commit is compared with its first parent, ` +
    "as a squash-merged pull request would be. These are changes written by people and already accepted. " +
    "The last column checks each line-level finding against git independently of the rules: the line at the " +
    "reported location holds the evidence, and the line occurs more often after the commit than before it.",
  "",
  "To reproduce, clone each repository with `git clone --depth 400 <url>`, check out the head commit below " +
    "and run `node --import tsx eval/real-history.ts --commits 100 <dirs>`.",
  "",
  "| Repository | Head commit | Commits checked | Commits with findings | " +
    ALL_RULES.map((r) => `\`${r.id}\``).join(" | ") +
    " |",
  `| --- | --- | --- | --- | ${ALL_RULES.map(() => "---").join(" | ")} |`,
];
const details: string[] = [];

for (const dir of positionals) {
  const url = git(dir, ["remote", "get-url", "origin"]);
  const name = `[${basename(dir)}](${url.replace(/\.git$/, "")})`;
  const head = git(dir, ["rev-parse", "HEAD"]);
  const shas = git(dir, ["rev-list", "--first-parent", "-n", values.commits!, "HEAD"]).split("\n");
  const hits: Hit[] = [];
  let checked = 0;
  for (const sha of shas) {
    let parent: string;
    try {
      parent = git(dir, ["rev-parse", "--verify", "--quiet", `${sha}^1`]);
    } catch {
      continue; // root commit
    }
    checked++;
    const subject = git(dir, ["log", "-1", "--format=%s", sha]);
    for (const finding of check({ repoDir: dir, base: parent, head: sha }).findings) {
      hits.push({ sha, subject, finding, verified: verify(dir, parent, sha, finding) });
    }
  }
  const perRule = ALL_RULES.map((r) => hits.filter((h) => h.finding.ruleId === r.id).length);
  lines.push(
    `| ${name} | \`${head.slice(0, 12)}\` | ${checked} | ${new Set(hits.map((h) => h.sha)).size} | ${perRule.join(" | ")} |`,
  );
  if (hits.length > 0) {
    details.push(
      `### ${basename(dir)}`,
      "",
      "| Commit | Subject | Rule | Where | Fact | Check against git |",
      "| --- | --- | --- | --- | --- | --- |",
    );
    for (const h of hits) {
      const loc = h.finding.locations[0];
      const where = loc ? `${loc.path}${loc.line ? `:${loc.line}` : ""}` : "";
      const cell = (s: string) => s.replace(/\|/g, "\\|");
      details.push(
        `| \`${h.sha.slice(0, 10)}\` | ${cell(h.subject)} | \`${h.finding.ruleId}\` | \`${where}\` | ${cell(h.finding.message)} | ${h.verified} |`,
      );
    }
    details.push("");
  }
}

const report = [...lines, "", "## All findings", "", ...details].join("\n");
if (values.out) writeFileSync(values.out, report);
else process.stdout.write(report);
