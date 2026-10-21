import { parse as parseToml } from "smol-toml";
import type { Rule } from "./types.js";

/** Read from the base commit, so a pull request cannot relax the checks it is held to. */
export const CONFIG_FILE = ".rsp.toml";

export interface RuleConfig {
  enabled: boolean;
  /** Globs of files whose findings this rule does not report. */
  exclude: string[];
  /** Finding keys this rule does not report: pattern ids, packages, variables or symbols. */
  allow: string[];
}

export interface Config {
  path: string;
  /** Globs of changed files hidden from every rule. */
  exclude: string[];
  rules: Record<string, RuleConfig>;
}

export class ConfigError extends Error {}

/**
 * Parses and validates .rsp.toml. Unknown keys, rules and pattern ids are
 * errors rather than warnings: a typo must not silently turn a check off.
 */
export function parseConfig(text: string, rules: Rule[], path = CONFIG_FILE): Config {
  let doc: Record<string, unknown>;
  try {
    doc = parseToml(text) as Record<string, unknown>;
  } catch (err) {
    throw new ConfigError(`${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const fail = (msg: string): never => {
    throw new ConfigError(`${path}: ${msg}`);
  };
  checkKeys(doc, ["exclude", "rules"], "", fail);

  const config: Config = { path, exclude: strings(doc.exclude, "exclude", fail), rules: {} };
  const ruleTables = doc.rules ?? {};
  if (!isTable(ruleTables)) fail("`rules` must be a table");
  for (const [id, value] of Object.entries(ruleTables as Record<string, unknown>)) {
    const rule = rules.find((r) => r.id === id);
    if (!rule) fail(`unknown rule "${id}"; known rules: ${rules.map((r) => r.id).join(", ")}`);
    if (!isTable(value)) fail(`rules."${id}" must be a table`);
    const table = value as Record<string, unknown>;
    checkKeys(table, ["enabled", "exclude", "allow"], `rules."${id}".`, fail);
    if (table.enabled !== undefined && typeof table.enabled !== "boolean") fail(`rules."${id}".enabled must be true or false`);
    const allow = strings(table.allow, `rules."${id}".allow`, fail);
    const unknown = rule!.knownKeys ? allow.filter((k) => !rule!.knownKeys!.includes(k)) : [];
    if (unknown.length > 0) {
      fail(`rules."${id}".allow: unknown ${unknown.map((k) => `"${k}"`).join(", ")}; known: ${rule!.knownKeys!.join(", ")}`);
    }
    config.rules[id] = {
      enabled: (table.enabled as boolean | undefined) ?? true,
      exclude: strings(table.exclude, `rules."${id}".exclude`, fail),
      allow,
    };
  }
  return config;
}

function checkKeys(table: Record<string, unknown>, known: string[], prefix: string, fail: (msg: string) => never): void {
  for (const key of Object.keys(table)) {
    if (!known.includes(key)) fail(`unknown key "${prefix}${key}"; expected one of ${known.map((k) => prefix + k).join(", ")}`);
  }
}

function strings(value: unknown, name: string, fail: (msg: string) => never): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) fail(`${name} must be a list of strings`);
  return [...new Set(value as string[])].sort();
}

function isTable(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}
