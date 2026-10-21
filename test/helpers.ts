import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Fixed identity and dates make fixture commit SHAs identical on every run.
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "rsp fixtures",
  GIT_AUTHOR_EMAIL: "fixtures@rsp.invalid",
  GIT_COMMITTER_NAME: "rsp fixtures",
  GIT_COMMITTER_EMAIL: "fixtures@rsp.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

export interface FixtureRepo {
  dir: string;
  base: string;
  head: string;
  cleanup(): void;
}

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, env: GIT_ENV, encoding: "utf8" }).trim();
}

/** Builds a throwaway repo with two commits: the `base/` tree, then the `head/` tree. */
export function makeFixtureRepo(caseDir: string): FixtureRepo {
  const dir = mkdtempSync(join(tmpdir(), "rsp-fixture-"));
  git(dir, ["init", "--quiet", "--initial-branch=main"]);

  const commit = (tree: string, message: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry !== ".git") rmSync(join(dir, entry), { recursive: true, force: true });
    }
    cpSync(join(caseDir, tree), dir, {
      recursive: true,
      filter: (src) => !src.endsWith(".gitkeep"),
    });
    git(dir, ["add", "--all"]);
    git(dir, ["commit", "--quiet", "--allow-empty", "-m", message]);
    return git(dir, ["rev-parse", "HEAD"]);
  };

  const base = commit("base", "base");
  const head = commit("head", "head");
  return { dir, base, head, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
