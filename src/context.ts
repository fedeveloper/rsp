import { parseUnifiedDiff } from "./diff.js";
import { diff, mergeBase, readAt, resolveCommit } from "./git.js";
import type { DiffContext } from "./types.js";

/**
 * Builds the context rules run against. `base` is resolved to the merge-base
 * with `head`, as GitHub does for pull requests.
 */
export function buildContext(repoDir: string, baseRef: string, headRef: string): DiffContext {
  const head = resolveCommit(repoDir, headRef);
  const base = mergeBase(repoDir, resolveCommit(repoDir, baseRef), head);
  const files = parseUnifiedDiff(diff(repoDir, base, head));

  const cache = new Map<string, string | undefined>();
  const read = (commit: string, path: string) => {
    const key = `${commit}:${path}`;
    if (!cache.has(key)) cache.set(key, readAt(repoDir, commit, path));
    return cache.get(key);
  };

  return {
    repoDir,
    base,
    head,
    files,
    readBase: (path) => read(base, path),
    readHead: (path) => read(head, path),
  };
}
