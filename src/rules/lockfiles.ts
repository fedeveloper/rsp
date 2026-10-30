// Readers for the parts of lockfiles that mirror a manifest. Each returns
// undefined when the file is not in a format it knows, so that the rule using
// it stays silent rather than guessing.
import { parse as parseToml } from "smol-toml";
import { normalizeDist } from "./python.js";

export const JS_DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
export type JsField = (typeof JS_DEPENDENCY_FIELDS)[number];

/** Declared ranges by field and package name, as package.json or a lockfile's copy of it records them. */
export type JsDeclared = Map<JsField, Map<string, string>>;

/**
 * What a JavaScript lockfile records about one package of the repository:
 * `ranges` when it copies the ranges of package.json (npm, pnpm), or
 * `has(name, range)` when it only lists resolved specifiers (Yarn).
 */
export interface JsLockView {
  /** Fields the lockfile records; ranges in other fields cannot be checked against it. */
  fields: readonly JsField[];
  /** The range recorded for a package in a field, or undefined when it is not listed. */
  range?(field: JsField, name: string): string | undefined;
  /** Whether the lockfile resolves `name@range`. */
  has?(name: string, range: string): boolean;
  /** Whether removing a package from package.json must remove it from this record. */
  mirrors: boolean;
}

export function jsDeclared(json: Record<string, unknown>): JsDeclared {
  const out: JsDeclared = new Map();
  for (const field of JS_DEPENDENCY_FIELDS) {
    const deps = json[field];
    const map = new Map<string, string>();
    if (deps && typeof deps === "object" && !Array.isArray(deps)) {
      for (const [name, range] of Object.entries(deps)) if (typeof range === "string") map.set(name, range);
    }
    out.set(field, map);
  }
  return out;
}

export function parseJson(text: string | undefined): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text ?? "");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * package-lock.json and npm-shrinkwrap.json, lockfile versions 2 and 3: the
 * entry `packages[dir]` copies the dependency fields of the package.json in
 * `dir` (relative to the lockfile, "" for its own directory).
 */
export function npmLock(text: string, dir: string): JsLockView | undefined {
  const json = parseJson(text);
  if (!json || (json.lockfileVersion !== 2 && json.lockfileVersion !== 3)) return undefined;
  const packages = json.packages;
  if (!packages || typeof packages !== "object") return undefined;
  const entry = (packages as Record<string, unknown>)[dir];
  if (!entry || typeof entry !== "object") return undefined;
  const declared = jsDeclared(entry as Record<string, unknown>);
  return { fields: JS_DEPENDENCY_FIELDS, range: (field, name) => declared.get(field)!.get(name), mirrors: true };
}

/**
 * pnpm-lock.yaml, lockfile versions 6 and 9: `importers.<dir>.<field>.<name>.specifier`
 * copies the range from package.json. Read with an indentation scanner, not a
 * YAML parser; anything unexpected makes the whole view unavailable.
 */
export function pnpmLock(text: string, dir: string): JsLockView | undefined {
  const version = /^lockfileVersion:\s*'?"?(\d+)/m.exec(text)?.[1];
  if (version !== "6" && version !== "9") return undefined;
  const lines = text.split("\n");
  const want = dir === "" ? "." : dir;
  const ranges = new Map<JsField, Map<string, string>>();
  let found = false;
  // Recent pnpm writes several YAML documents (`---`), each with its own `importers:`.
  for (let start = lines.indexOf("importers:"); start >= 0; start = lines.indexOf("importers:", start + 1)) {
    let inImporter = false;
    let field: JsField | undefined;
    let name: string | undefined;
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.trim() === "") continue;
      if (/^\S/.test(line)) break; // the next top-level key or document
      const indent = line.length - line.trimStart().length;
      const key = unquote(line.trim().replace(/:.*$/, ""));
      const value = line.includes(":") ? line.slice(line.indexOf(":") + 1).trim() : "";
      if (indent === 2) {
        inImporter = key === want;
        found ||= inImporter;
        field = undefined;
      } else if (!inImporter) {
        continue;
      } else if (indent === 4) {
        field = (JS_DEPENDENCY_FIELDS as readonly string[]).includes(key) ? (key as JsField) : undefined;
      } else if (indent === 6 && field) {
        name = key;
      } else if (indent === 8 && field && name && key === "specifier") {
        if (!ranges.has(field)) ranges.set(field, new Map());
        ranges.get(field)!.set(name, unquote(value));
      }
    }
  }
  if (!found) return undefined;
  // pnpm records peer dependencies of the project itself only when they are also installed.
  const fields: JsField[] = ["dependencies", "devDependencies", "optionalDependencies"];
  return { fields, range: (f, n) => ranges.get(f)?.get(n), mirrors: true };
}

/**
 * yarn.lock, classic (v1) and Berry: entries are keyed by every specifier they
 * resolve, such as `"lodash@^4.17.0", "lodash@^4.17.21":` (classic, each one
 * quoted) or `"lodash@npm:4.17.21, lodash@npm:^4.17.21":` (Berry, quoted as a
 * whole). Peer dependencies are not resolved.
 */
export function yarnLock(text: string): JsLockView | undefined {
  if (!/^# yarn lockfile v1$/m.test(text) && !/^__metadata:$/m.test(text)) return undefined;
  const specs = new Set<string>();
  for (const line of text.split("\n")) {
    if (!/^\S.*:$/.test(line) || line.startsWith("#") || line.startsWith("__metadata")) continue;
    for (const part of line.slice(0, -1).split(",")) specs.add(part.trim().replace(/^["']|["']$/g, ""));
  }
  return {
    fields: ["dependencies", "devDependencies", "optionalDependencies"],
    has: (name, range) => specs.has(`${name}@${range}`) || specs.has(`${name}@npm:${range}`),
    mirrors: false,
  };
}

function unquote(s: string): string {
  return s.replace(/^(['"])(.*)\1$/, "$2");
}

/** The lockfile a Python project has, and the normalized names of what it lists for that project. */
export interface PyLockView {
  /** Names the lockfile records as requirements of the project, or every locked package. */
  names: Set<string>;
  /** Whether the names are the project's own requirements, so a removed one must disappear too. */
  mirrors: boolean;
}

/**
 * uv.lock: the package whose source is the project directory (`editable` or
 * `virtual`) records the project's requirements in `[package.metadata]`
 * `requires-dist` and `requires-dev`.
 */
export function uvLock(text: string, project: string, dir: string): PyLockView | undefined {
  const doc = toml(text);
  if (!doc || !Array.isArray(doc.package)) return undefined;
  const want = dir === "" ? "." : dir;
  const pkg = doc.package.find(
    (p: any) => normalizeDist(String(p?.name ?? "")) === normalizeDist(project) && (p?.source?.editable === want || p?.source?.virtual === want),
  );
  const meta = pkg?.metadata;
  if (!meta || typeof meta !== "object") return undefined;
  const names = new Set<string>();
  const addAll = (list: unknown) => {
    if (Array.isArray(list)) for (const r of list) if (typeof r?.name === "string") names.add(normalizeDist(r.name));
  };
  addAll(meta["requires-dist"]);
  const dev = meta["requires-dev"];
  if (dev && typeof dev === "object") Object.values(dev).forEach(addAll);
  return { names, mirrors: true };
}

/** poetry.lock and pdm.lock: every locked package, `[[package]] name = "..."`. */
export function packageListLock(text: string): PyLockView | undefined {
  const doc = toml(text);
  if (!doc || !Array.isArray(doc.package)) return undefined;
  const names = new Set<string>();
  for (const p of doc.package) if (typeof p?.name === "string") names.add(normalizeDist(p.name));
  return { names, mirrors: false };
}

/** Pipfile.lock: the packages of `default` and `develop`. */
export function pipfileLock(text: string): PyLockView | undefined {
  const json = parseJson(text);
  if (!json || !json._meta) return undefined;
  const names = new Set<string>();
  for (const section of [json.default, json.develop]) {
    if (section && typeof section === "object") Object.keys(section).forEach((n) => names.add(normalizeDist(n)));
  }
  return { names, mirrors: false };
}

function toml(text: string): Record<string, any> | undefined {
  try {
    return parseToml(text) as Record<string, any>;
  } catch {
    return undefined;
  }
}
