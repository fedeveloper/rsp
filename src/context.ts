import { parseUnifiedDiff } from "./diff.js";
import { diff, listFiles, mergeBase, readAt, resolveCommit } from "./git.js";
import { globToRegExp } from "./glob.js";
import type { DiffContext } from "./types.js";

/**
 * Builds the context rules run against. `base` is resolved to the merge-base
 * with `head`, as GitHub does for pull requests. Changed files matching an
 * `exclude` glob are hidden from rules; manifests and other files can still be read.
 */
export function buildContext(repoDir: string, baseRef: string, headRef: string, exclude: string[] = []): DiffContext {
  const head = resolveCommit(repoDir, headRef);
  const base = mergeBase(repoDir, resolveCommit(repoDir, baseRef), head);
  const excluded = exclude.map(globToRegExp);
  const files = parseUnifiedDiff(diff(repoDir, base, head)).filter(
    (f) => !excluded.some((re) => re.test(f.path) || re.test(f.oldPath)),
  );

  const cache = new Map<string, string | undefined>();
  const read = (commit: string, path: string) => {
    const key = `${commit}:${path}`;
    if (!cache.has(key)) cache.set(key, readAt(repoDir, commit, path));
    return cache.get(key);
  };
  let headFiles: string[] | undefined;

  return {
    repoDir,
    base,
    head,
    files,
    readBase: (path) => read(base, path),
    readHead: (path) => read(head, path),
    listHead: () => (headFiles ??= listFiles(repoDir, head)),
  };
}
