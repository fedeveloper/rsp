import { readFileSync } from "node:fs";
import { CONFIG_FILE, type Config, parseConfig } from "./config.js";
import { buildContext } from "./context.js";
import { runRules } from "./engine.js";
import { globToRegExp } from "./glob.js";
import { mergeRuns } from "./junit.js";
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
  /** Read .rsp.toml from the base commit (default true). */
  config?: boolean;
  /** JUnit report files of the tests run at base and at head, for the tests/delta rule. */
  junitBase?: string[];
  junitHead?: string[];
}

export function check(opts: CheckOptions): Report {
  const exclude = [...new Set(opts.exclude ?? [])].sort();
  const ctx = buildContext(opts.repoDir, opts.base, opts.head ?? "HEAD", exclude);
  const text = opts.config === false ? undefined : ctx.readBase(CONFIG_FILE);
  const config: Config | undefined = text === undefined ? undefined : parseConfig(text, ALL_RULES);
  if (config && config.exclude.length > 0) {
    const excluded = config.exclude.map(globToRegExp);
    ctx.files = ctx.files.filter((f) => !excluded.some((re) => re.test(f.path) || re.test(f.oldPath)));
  }
  if (opts.junitBase?.length && opts.junitHead?.length) {
    const read = (paths: string[]) => mergeRuns(paths.map((path) => ({ path, xml: readFileSync(path, "utf8") })));
    ctx.tests = { base: read(opts.junitBase), head: read(opts.junitHead) };
  } else if (opts.junitBase?.length || opts.junitHead?.length) {
    throw new Error("JUnit reports must be given for both base and head");
  }
  // Rules named on the command line run even when the configuration disables them.
  const rules = opts.rules ? selectRules(opts.rules) : ALL_RULES.filter((r) => config?.rules[r.id]?.enabled !== false);
  const options = [
    ...exclude.map((g) => `--exclude ${shellQuote(g)}`),
    ...(opts.config === false ? ["--no-config"] : []),
    ...(ctx.tests?.base.files ?? []).map((f) => `--junit-base ${shellQuote(f)}`),
    ...(ctx.tests?.head.files ?? []).map((f) => `--junit-head ${shellQuote(f)}`),
  ];
  return runRules(ctx, rules, options, config);
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

export { ConfigError } from "./config.js";
export { ALL_RULES } from "./rules/index.js";
export { toJson } from "./report/json.js";
export { toMarkdown } from "./report/markdown.js";
export type * from "./types.js";
