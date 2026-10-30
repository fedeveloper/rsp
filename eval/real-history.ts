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
  if (f.ruleId === "interface/removed-still-used") return verifyRemoved(dir, base, head, f);
  if (f.ruleId === "interface/route-removed") return verifyRoute(dir, base, head, f);
  if (!loc?.line) return "n/a";
  const text = execFileSync("git", ["-C", dir, "show", `${head}:${loc.path}`], { encoding: "utf8" }).split("\n")[loc.line - 1];
  if (text?.trim() !== f.evidence) return "WRONG LINE";
  if (f.message.startsWith("Parameters") || f.message.startsWith("Return type")) return verifySignature(dir, base, head, f);
  if (f.message.startsWith("Fields")) return verifyFields(dir, base, head, f);
  if (!f.message.startsWith("Added") && !f.message.startsWith("Imports") && !f.message.startsWith("Reads")) return "line ok";
  const before = countLine(dir, base, text);
  const after = countLine(dir, head, text);
  return after > before ? `new line (${before} -> ${after})` : `NOT NEW (${before} -> ${after})`;
}

/**
 * For a removed route: the evidence is a line of the file at base, and the
 * quoted path no longer occurs in that line form anywhere at head.
 */
function verifyRoute(dir: string, base: string, head: string, f: Finding): string {
  const file = f.locations[0]!.path;
  let baseText = "";
  try {
    baseText = execFileSync("git", ["-C", dir, "show", `${base}:${file}`], { encoding: "utf8" });
  } catch {
    return "FILE NOT AT BASE";
  }
  if (!baseText.split("\n").some((l) => l.trim() === f.evidence)) return "EVIDENCE NOT AT BASE";
  return countLine(dir, head, baseText.split("\n").find((l) => l.trim() === f.evidence)!) === 0 ? "route line gone at head" : "CHECK: same line still at head";
}

/**
 * For a removed name: the importer line at head holds the evidence and names
 * it, the module at base defines it on a line of its own, and the module at
 * head does not contain the word at all.
 */
function verifyRemoved(dir: string, base: string, head: string, f: Finding): string {
  const loc = f.locations[0]!;
  const show = (commit: string, path: string) => execFileSync("git", ["-C", dir, "show", `${commit}:${path}`], { encoding: "utf8" });
  const [name, module] = [...f.message.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
  const line = show(head, loc.path).split("\n")[loc.line! - 1];
  if (line?.trim() !== f.evidence) return "WRONG LINE";
  if (name !== "default" && !line.includes(name!)) return "NAME NOT ON LINE";
  const word = new RegExp(`\\b${name}\\b`);
  const definedAtBase = show(base, module!).split("\n").some((l) => word.test(l) && /^(export\s|def\s|async\s+def\s|class\s|[A-Za-z_]\w*\s*[:=])/.test(l));
  if (!definedAtBase) return "NOT DEFINED AT BASE";
  if (name === "default") return /^\s*export\s+default\b/m.test(show(head, module!)) ? "STILL EXPORTED" : "default export removed";
  return word.test(show(head, module!)) ? "NAME STILL IN MODULE" : "removed, still imported";
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
  const trimmed = (commit: string) =>
    execFileSync("git", ["-C", dir, "show", `${commit}:${loc.path}`], { encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim())
      .join("\n");
  // Methods of several classes can share a definition, so count them.
  const count = (text: string) => text.split(def.join("\n")).length - 1;
  return count(trimmed(base)) < count(trimmed(head)) ? "definition changed" : "SAME AT BASE";
}

/** For a type's fields: each removed field is a member at base and not at head, each added one the other way round. */
function verifyFields(dir: string, base: string, head: string, f: Finding): string {
  const name = /`([^`]+)`/.exec(f.message)![1]!;
  const block = (commit: string) => {
    const text = execFileSync("git", ["-C", dir, "show", `${commit}:${f.locations[0]!.path}`], { encoding: "utf8" }).split("\n");
    const start = text.findIndex((l) => new RegExp(`export\\s+(interface|type)\\s+${name}\\b`).test(l));
    if (start < 0) return undefined;
    const indent = /^\s*/.exec(text[start]!)![0];
    const end = text.findIndex((l, i) => i > start && l.startsWith(`${indent}}`));
    return text.slice(start + 1, end).join("\n");
  };
  const before = block(base);
  const after = block(head);
  if (before === undefined || after === undefined) return "TYPE NOT FOUND";
  const member = (b: string, field: string, optional: boolean) =>
    new RegExp(`^\\s*(readonly\\s+)?["']?${field}["']?${optional ? "\\?" : ""}\\s*[:(<]`, "m").test(b);
  const removed = [.../removed ([^;]+)/.exec(f.message)?.[1]?.matchAll(/`([^`]+)`/g) ?? []].map((m) => m[1]!);
  const added = [.../added required ([^;]+)/.exec(f.message)?.[1]?.matchAll(/`([^`]+)`/g) ?? []].map((m) => m[1]!);
  for (const r of removed) if (!member(before, r, false) && !member(before, r, true)) return `CHECK: ${r} not at base`;
  for (const r of removed) if (member(after, r, false) || member(after, r, true)) return `CHECK: ${r} still at head`;
  for (const a of added) if (!member(after, a, false) || member(before, a, false) || member(before, a, true)) return `CHECK: ${a}`;
  return "fields changed";
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
