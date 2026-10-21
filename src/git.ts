import { execFileSync } from "node:child_process";

// Overrides user config that would change diff output.
const STABLE_CONFIG = [
  "-c", "core.quotePath=false",
  "-c", "diff.noprefix=false",
  "-c", "diff.mnemonicPrefix=false",
  "-c", "diff.renames=true",
];

export function git(repoDir: string, args: string[]): string {
  return execFileSync("git", [...STABLE_CONFIG, ...args], {
    cwd: repoDir,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function resolveCommit(repoDir: string, ref: string): string {
  return git(repoDir, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).trim();
}

export function mergeBase(repoDir: string, a: string, b: string): string {
  return git(repoDir, ["merge-base", a, b]).trim();
}

export function diff(repoDir: string, base: string, head: string): string {
  return git(repoDir, [
    "diff", "--no-color", "--no-ext-diff", "--no-textconv",
    "--find-renames", "--unified=0", base, head,
  ]);
}

/** Returns file content at a commit, or undefined if the path does not exist there. */
export function readAt(repoDir: string, commit: string, path: string): string | undefined {
  try {
    return git(repoDir, ["show", `${commit}:${path}`]);
  } catch {
    return undefined;
  }
}
