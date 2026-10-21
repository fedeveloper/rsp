// Runs a project's test command at base and at head, each in its own git
// worktree, and collects the JUnit reports it writes. Used by the Action; the
// tests/delta rule itself only reads the reports.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { git, mergeBase, resolveCommit } from "./git.js";
import { globToRegExp } from "./glob.js";
import { mergeRuns } from "./junit.js";

export interface TestRunOptions {
  repoDir: string;
  base: string;
  head: string;
  /** Shell command that installs dependencies and runs the tests, writing JUnit XML. */
  command: string;
  /** Glob, relative to the repository root, of the JUnit files the command writes. */
  junit: string;
  /** Extra runs at head when tests fail there but passed at base, to clear flaky failures. */
  retries: number;
  /** Scratch directory for the worktrees and the collected reports. */
  workDir: string;
  log: (line: string) => void;
}

export function runTestsAtBaseAndHead(opts: TestRunOptions): { junitBase: string[]; junitHead: string[] } {
  const head = resolveCommit(opts.repoDir, opts.head);
  const base = mergeBase(opts.repoDir, resolveCommit(opts.repoDir, opts.base), head);
  const reports = join(opts.workDir, "rsp-junit");
  mkdirSync(reports, { recursive: true });

  const runAt = (label: "base" | "head", commit: string, attempt: number): string[] => {
    const dir = join(opts.workDir, `rsp-${label}`);
    if (attempt === 0) {
      rmSync(dir, { recursive: true, force: true });
      git(opts.repoDir, ["worktree", "add", "--detach", "--force", dir, commit]);
    }
    opts.log(`::group::rsp: tests at ${label} ${commit.slice(0, 12)}${attempt > 0 ? ` (rerun ${attempt})` : ""}`);
    // The tests are the pull request's code: they get no tokens or step files, and cannot issue workflow commands.
    const stop = randomBytes(16).toString("hex");
    opts.log(`::stop-commands::${stop}`);
    const res = spawnSync("bash", ["-c", opts.command], { cwd: dir, env: testEnv(process.env), stdio: ["ignore", "inherit", "inherit"] });
    opts.log(`::${stop}::`);
    opts.log(`::endgroup::`);
    opts.log(`rsp: test command at ${label} exited with ${res.status ?? res.signal}`);
    const found = findFiles(dir, globToRegExp(opts.junit));
    if (found.length === 0) opts.log(`::warning::rsp: the test command wrote no file matching ${opts.junit} at ${label}`);
    return found.map((f, i) => {
      const target = join(reports, `${label}-${attempt}-${i}.xml`);
      copyFileSync(join(dir, f), target);
      return target;
    });
  };

  try {
    const junitBase = runAt("base", base, 0);
    const junitHead = runAt("head", head, 0);
    const read = (paths: string[]) => mergeRuns(paths.map((path) => ({ path, xml: readFileSync(path, "utf8") })));
    const baseResults = read(junitBase).results;
    for (let attempt = 1; attempt <= opts.retries; attempt++) {
      const headResults = read(junitHead).results;
      const newFailures = [...headResults].filter(([id, s]) => s === "failed" && baseResults.get(id) === "passed");
      if (newFailures.length === 0) break;
      junitHead.push(...runAt("head", head, attempt));
    }
    return { junitBase, junitHead };
  } finally {
    for (const label of ["base", "head"]) {
      try {
        git(opts.repoDir, ["worktree", "remove", "--force", join(opts.workDir, `rsp-${label}`)]);
      } catch {
        // Already gone, or never created because an earlier step failed.
      }
    }
  }
}

/**
 * The environment for the test command: the runner's, without the action's
 * inputs (which include the GitHub token), the runtime tokens of Actions, and
 * the files through which a step sets outputs, environment and paths for later
 * steps.
 */
export function testEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (/^(INPUT_|ACTIONS_)/.test(key)) continue;
    if (/^GITHUB_(TOKEN|ENV|OUTPUT|PATH|STATE|STEP_SUMMARY)$/.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Files under `root` whose path relative to it matches, sorted; dependencies, .git and symbolic links are skipped. */
function findFiles(root: string, pattern: RegExp, dir = root, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === ".git" || entry === "node_modules" || entry === ".venv") continue;
    const path = join(dir, entry);
    const rel = relative(root, path);
    const stat = lstatSync(path);
    // A link written by the tests could point anywhere on the runner.
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) findFiles(root, pattern, path, out);
    else if (pattern.test(rel)) out.push(rel);
  }
  return out;
}
