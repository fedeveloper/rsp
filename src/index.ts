import { buildContext } from "./context.js";
import { runRules } from "./engine.js";
import { ALL_RULES } from "./rules/index.js";
import type { Report } from "./types.js";

export interface CheckOptions {
  repoDir: string;
  base: string;
  head?: string;
  /** Rule ids to run; all rules when omitted. */
  rules?: string[];
  /** Globs of changed files to ignore, e.g. `tests/fixtures/**`. */
  exclude?: string[];
}

export function check(opts: CheckOptions): Report {
  const rules = opts.rules ? selectRules(opts.rules) : ALL_RULES;
  const exclude = [...new Set(opts.exclude ?? [])].sort();
  const ctx = buildContext(opts.repoDir, opts.base, opts.head ?? "HEAD", exclude);
  return runRules(ctx, rules, exclude.map((g) => `--exclude ${shellQuote(g)}`));
}

function selectRules(ids: string[]) {
  const unknown = ids.filter((id) => !ALL_RULES.some((r) => r.id === id));
  if (unknown.length > 0) {
    throw new Error(`Unknown rule: ${unknown.join(", ")}. Known rules: ${ALL_RULES.map((r) => r.id).join(", ")}`);
  }
  return ALL_RULES.filter((r) => ids.includes(r.id));
}

function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

export { ALL_RULES } from "./rules/index.js";
export { toJson } from "./report/json.js";
export { toMarkdown } from "./report/markdown.js";
export type * from "./types.js";
