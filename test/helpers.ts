import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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
  return makeRepo((dir, tree) =>
    cpSync(join(caseDir, tree), dir, { recursive: true, filter: (src) => !src.endsWith(".gitkeep") }),
  );
}

/** Builds a throwaway repo from two in-memory trees of path to content. */
export function makeRepoFromTrees(base: Map<string, string>, head: Map<string, string>): FixtureRepo {
  return makeRepo((dir, tree) => {
    for (const [path, content] of tree === "base" ? base : head) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
  });
}

function makeRepo(fill: (dir: string, tree: "base" | "head") => void): FixtureRepo {
  const dir = mkdtempSync(join(tmpdir(), "rsp-fixture-"));
  git(dir, ["init", "--quiet", "--initial-branch=main"]);

  const commit = (tree: "base" | "head") => {
    for (const entry of readdirSync(dir)) {
      if (entry !== ".git") rmSync(join(dir, entry), { recursive: true, force: true });
    }
    fill(dir, tree);
    git(dir, ["add", "--all"]);
    git(dir, ["commit", "--quiet", "--allow-empty", "-m", tree]);
    return git(dir, ["rev-parse", "HEAD"]);
  };

  const base = commit("base");
  const head = commit("head");
  return { dir, base, head, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
