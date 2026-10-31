import { parse as parseToml } from "smol-toml";
import type { DiffContext, FileChange, RawFinding, Rule } from "../types.js";
import {
  JS_DEPENDENCY_FIELDS,
  type JsDeclared,
  type JsField,
  type JsLockView,
  jsDeclared,
  npmLock,
  packageListLock,
  parseJson,
  pipfileLock,
  pnpmLock,
  type PyLockView,
  uvLock,
  yarnLock,
} from "./lockfiles.js";
import { goSumEntries, parseGoMod } from "./go.js";
import { normalizeDist } from "./python.js";
import { codeSpan } from "../text.js";

const JS_LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"];
const PY_LOCKFILES = ["uv.lock", "poetry.lock", "pdm.lock"];

// Ranges that do not name a registry version, which lockfiles record in their own ways.
const LOCAL_RANGE = /^(workspace:|file:|link:|portal:|patch:|git|github:|https?:|catalog:)|\//;

export const depsLockfile: Rule = {
  id: "deps/lockfile",
  version: "0.1.0",
  keys: "the package name or Go module path, e.g. `zod` or `httpx`",
  description:
    "Dependencies added, changed or removed in package.json, pyproject.toml, Pipfile or go.mod by the diff that the lockfile " +
    "next to them (package-lock.json, pnpm-lock.yaml, yarn.lock, uv.lock, poetry.lock, pdm.lock, Pipfile.lock, go.sum) does not match. " +
    "Only lockfiles that existed at base and that rsp can read.",
  run(ctx) {
    const findings: RawFinding[] = [];
    for (const file of ctx.files) {
      if (file.binary || file.status !== "modified") continue;
      const name = file.path.split("/").pop();
      if (name === "package.json") findings.push(...javascript(ctx, file));
      else if (name === "pyproject.toml") findings.push(...pyproject(ctx, file));
      else if (name === "Pipfile") findings.push(...pipfile(ctx, file));
      else if (name === "go.mod") findings.push(...goMod(ctx, file));
    }
    return findings;
  },
};

function dirOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
}

/**
 * The lockfile that covers a manifest: in its directory or the nearest one
 * above, present at base and at head. Two kinds of lockfile in the same
 * directory leave it unclear which one is used, so there is none.
 */
function nearestLock(ctx: DiffContext, manifest: string, names: string[]): { path: string; dir: string } | undefined {
  let dir = dirOf(manifest);
  for (;;) {
    const present = names.filter((n) => ctx.readHead(dir + n) !== undefined && ctx.readBase(dir + n) !== undefined);
    if (present.length > 1) return undefined;
    if (present.length === 1) return { path: dir + present[0], dir };
    if (dir === "") return undefined;
    dir = dirOf(dir.slice(0, -1));
  }
}

/** The first added line of the manifest that mentions the package, for the location and evidence. */
function addedLine(file: FileChange, pattern: RegExp): { line?: number; text: string } | undefined {
  const l = file.lines.find((x) => x.kind === "add" && pattern.test(x.text));
  return l && { line: l.newLine, text: l.text.trim() };
}

function removedLine(file: FileChange, pattern: RegExp): string | undefined {
  return file.lines.find((x) => x.kind === "del" && pattern.test(x.text))?.text.trim();
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function javascript(ctx: DiffContext, file: FileChange): RawFinding[] {
  const before = parseJson(ctx.readBase(file.oldPath));
  const after = parseJson(ctx.readHead(file.path));
  if (!before || !after) return [];
  const lock = nearestLock(ctx, file.path, JS_LOCKFILES);
  if (!lock) return [];
  const text = ctx.readHead(lock.path)!;
  const lockName = lock.path.split("/").pop()!;
  const rel = dirOf(file.path).slice(lock.dir.length).replace(/\/$/, "");
  const view: JsLockView | undefined =
    lockName === "pnpm-lock.yaml" ? pnpmLock(text, rel) : lockName === "yarn.lock" ? yarnLock(text) : npmLock(text, rel);
  if (!view) return [];

  const old: JsDeclared = jsDeclared(before);
  const now: JsDeclared = jsDeclared(after);
  const findings: RawFinding[] = [];
  const at = (line: number | undefined) => [{ path: file.path, ...(line !== undefined && { line }) }, { path: lock.path }];
  for (const field of JS_DEPENDENCY_FIELDS) {
    if (!view.fields.includes(field)) continue;
    for (const [name, range] of now.get(field)!) {
      if (old.get(field)!.get(name) === range || LOCAL_RANGE.test(range)) continue;
      const quoted = new RegExp(`"${escape(name)}"\\s*:`);
      const added = addedLine(file, quoted);
      // A package.json rewritten without changing this entry, such as reformatted, is not a change to check.
      if (!added) continue;
      if (view.range) {
        const recorded = view.range(field, name);
        if (recorded === range) continue;
        findings.push({
          key: name,
          message:
            recorded === undefined
              ? `Declares ${codeSpan(name)} ${codeSpan(range)} in ${field}; ${lockName} does not list it`
              : `Declares ${codeSpan(name)} ${codeSpan(range)} in ${field}; ${lockName} records ${codeSpan(recorded)}`,
          locations: at(added.line),
          evidence: added.text,
        });
      } else if (view.has && !view.has(name, range)) {
        findings.push({
          key: name,
          message: `Declares ${codeSpan(name)} ${codeSpan(range)} in ${field}; ${lockName} has no entry for ${codeSpan(`${name}@${range}`)}`,
          locations: at(added.line),
          evidence: added.text,
        });
      }
    }
    if (!view.mirrors || !view.range) continue;
    for (const [name, range] of old.get(field)!) {
      if (now.get(field)!.has(name) || LOCAL_RANGE.test(range)) continue;
      const removed = removedLine(file, new RegExp(`"${escape(name)}"\\s*:`));
      if (!removed || view.range(field, name) === undefined) continue;
      findings.push({
        key: name,
        message: `Removes ${codeSpan(name)} from ${field}; ${lockName} still lists it`,
        locations: at(undefined),
        evidence: removed,
      });
    }
  }
  return findings;
}

/** Requirement names of a pyproject.toml by where they are declared, normalized. */
function pyprojectNames(text: string | undefined): { project?: string; names: Set<string>; poetry: boolean } | undefined {
  let doc: Record<string, any>;
  try {
    doc = parseToml(text ?? "") as Record<string, any>;
  } catch {
    return undefined;
  }
  const names = new Set<string>();
  const requirement = (r: unknown) => {
    const m = typeof r === "string" ? /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(r) : null;
    if (m) names.add(normalizeDist(m[1]!));
  };
  const list = (v: unknown) => Array.isArray(v) && v.forEach(requirement);
  const lists = (v: unknown) => v && typeof v === "object" && Object.values(v).forEach(list);
  const table = (v: unknown) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).forEach(requirement);
  list(doc.project?.dependencies);
  lists(doc.project?.["optional-dependencies"]);
  lists(doc["dependency-groups"]);
  list(doc.tool?.uv?.["dev-dependencies"]);
  lists(doc.tool?.pdm?.["dev-dependencies"]);
  const poetry = doc.tool?.poetry;
  table(poetry?.dependencies);
  table(poetry?.["dev-dependencies"]);
  if (poetry?.group && typeof poetry.group === "object") for (const g of Object.values(poetry.group)) table((g as any)?.dependencies);
  names.delete("python");
  return { project: typeof doc.project?.name === "string" ? doc.project.name : undefined, names, poetry: !!poetry };
}

function pyproject(ctx: DiffContext, file: FileChange): RawFinding[] {
  const before = pyprojectNames(ctx.readBase(file.oldPath));
  const after = pyprojectNames(ctx.readHead(file.path));
  if (!before || !after) return [];
  const lock = nearestLock(ctx, file.path, PY_LOCKFILES);
  if (!lock) return [];
  const text = ctx.readHead(lock.path)!;
  const lockName = lock.path.split("/").pop()!;
  let view: PyLockView | undefined;
  if (lockName === "uv.lock") {
    if (!after.project) return [];
    view = uvLock(text, after.project, dirOf(file.path).slice(lock.dir.length).replace(/\/$/, ""));
  } else {
    // poetry.lock and pdm.lock list every package; only a lockfile in the project's own directory is certainly its own.
    if (lock.dir !== dirOf(file.path)) return [];
    view = packageListLock(text);
  }
  return view ? compareNames(file, lock.path, lockName, before.names, after.names, view, /[A-Za-z0-9][A-Za-z0-9._-]*/g) : [];
}

function pipfile(ctx: DiffContext, file: FileChange): RawFinding[] {
  const names = (text: string | undefined) => {
    try {
      const doc = parseToml(text ?? "") as Record<string, any>;
      const out = new Set<string>();
      for (const t of [doc.packages, doc["dev-packages"]]) if (t && typeof t === "object") Object.keys(t).forEach((n) => out.add(normalizeDist(n)));
      return out;
    } catch {
      return undefined;
    }
  };
  const before = names(ctx.readBase(file.oldPath));
  const after = names(ctx.readHead(file.path));
  const lockPath = `${dirOf(file.path)}Pipfile.lock`;
  if (!before || !after || ctx.readBase(lockPath) === undefined || ctx.readHead(lockPath) === undefined) return [];
  const view = pipfileLock(ctx.readHead(lockPath)!);
  return view ? compareNames(file, lockPath, "Pipfile.lock", before, after, view, /[A-Za-z0-9][A-Za-z0-9._-]*/g) : [];
}

/**
 * go.mod: modules required by an added `require` line, at a version go.sum
 * has no line for. Modules replaced by a local directory have no checksum.
 * go.sum keeps lines of modules no longer required, so removals are not compared.
 */
function goMod(ctx: DiffContext, file: FileChange): RawFinding[] {
  const before = parseGoMod(ctx.readBase(file.oldPath) ?? "", file.oldPath);
  const after = parseGoMod(ctx.readHead(file.path) ?? "", file.path);
  const sumPath = `${dirOf(file.path)}go.sum`;
  const sumText = ctx.readHead(sumPath);
  if (!before || !after || sumText === undefined || ctx.readBase(sumPath) === undefined) return [];
  const sums = goSumEntries(sumText);
  const added = new Set(file.lines.filter((l) => l.kind === "add").map((l) => l.newLine));
  const lines = (ctx.readHead(file.path) ?? "").split("\n");
  const findings: RawFinding[] = [];
  for (const [path, version] of after.require) {
    const line = after.lines.get(path)!;
    if (before.require.get(path) === version || !added.has(line)) continue;
    if (after.replace.has(path) || sums.has(`${path} ${version}`)) continue;
    findings.push({
      key: path,
      message: `Requires ${codeSpan(path)} ${codeSpan(version)} in go.mod; go.sum has no line for it`,
      locations: [{ path: file.path, line }, { path: sumPath }],
      evidence: lines[line - 1]!.trim(),
    });
  }
  return findings;
}

/** Python manifests: names added that the lockfile lacks, and, when it mirrors the project, names removed that it keeps. */
function compareNames(
  file: FileChange,
  lockPath: string,
  lockName: string,
  before: Set<string>,
  after: Set<string>,
  view: PyLockView,
  word: RegExp,
): RawFinding[] {
  const mentions = (text: string, name: string) => [...text.matchAll(word)].some((m) => normalizeDist(m[0]) === name);
  const findings: RawFinding[] = [];
  const manifest = file.path.split("/").pop()!;
  for (const name of [...after].sort()) {
    if (before.has(name) || view.names.has(name)) continue;
    const added = file.lines.find((l) => l.kind === "add" && mentions(l.text, name));
    if (!added) continue;
    findings.push({
      key: name,
      message: `Declares ${codeSpan(name)} in ${manifest}; ${lockName} does not list it`,
      locations: [{ path: file.path, line: added.newLine }, { path: lockPath }],
      evidence: added.text.trim(),
    });
  }
  if (!view.mirrors) return findings;
  for (const name of [...before].sort()) {
    if (after.has(name) || !view.names.has(name)) continue;
    const removed = file.lines.find((l) => l.kind === "del" && mentions(l.text, name));
    if (!removed) continue;
    findings.push({
      key: name,
      message: `Removes ${codeSpan(name)} from ${manifest}; ${lockName} still lists it`,
      locations: [{ path: file.path }, { path: lockPath }],
      evidence: removed.text.trim(),
    });
  }
  return findings;
}
