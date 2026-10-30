import { parse as parseToml } from "smol-toml";
import type { DiffContext } from "../types.js";
import { normalizeDist } from "./python.js";

export interface DeclaredDeps {
  /** Manifest paths that were read. */
  manifests: string[];
  /** Normalized distribution names declared in any of them. */
  names: Set<string>;
  /** Manifests whose dependency lists are computed from other files, so the names above may be incomplete. */
  dynamic: string[];
}

const REQUIREMENTS = /(^|\/)(requirements[^/]*\.(txt|in)|requirements\/[^/]+\.(txt|in))$/;
const REQUIREMENT_NAME = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/;

const ENVIRONMENT_YML = /(^|\/)environment\.ya?ml$/;
const INCLUDE = /^\s*(?:-r|--requirement|-c|--constraint)(?:\s+|=)(\S+)/;

/**
 * Every dependency declared at head, across pyproject.toml (PEP 621, PEP 735,
 * Poetry, PDM, uv), requirements files and the files they include with `-r`
 * or `-c`, Pipfile, conda environment files, setup.cfg and literal lists in
 * setup.py. Reading more files can only hide a finding, never invent one.
 */
export function declaredDependencies(ctx: DiffContext): DeclaredDeps {
  const manifests: string[] = [];
  const dynamic: string[] = [];
  const names = new Set<string>();
  const add = (requirement: string) => {
    const m = REQUIREMENT_NAME.exec(requirement);
    if (m) names.add(normalizeDist(m[1]!));
  };

  // Requirements files, and every file they include with -r or -c whatever its name.
  const requirements = new Set(ctx.listHead().filter((p) => REQUIREMENTS.test(p)));
  for (const path of requirements) {
    for (const target of includes(path, ctx.readHead(path) ?? "")) {
      if (ctx.readHead(target) !== undefined) requirements.add(target);
    }
  }

  for (const path of [...new Set([...ctx.listHead(), ...requirements])].sort()) {
    const base = path.split("/").pop()!;
    let found: string[] | undefined;
    if (base === "pyproject.toml") found = fromPyproject(ctx.readHead(path) ?? "");
    else if (requirements.has(path)) {
      found = fromRequirements(ctx.readHead(path) ?? "");
    } else if (base === "Pipfile") found = fromPipfile(ctx.readHead(path) ?? "");
    else if (ENVIRONMENT_YML.test(path)) found = fromEnvironmentYml(ctx.readHead(path) ?? "");
    else if (base === "setup.cfg") found = fromSetupCfg(ctx.readHead(path) ?? "");
    else if (base === "setup.py") {
      const text = ctx.readHead(path) ?? "";
      found = fromSetupPy(text);
      if (setupPyIsDynamic(text)) dynamic.push(path);
    }
    if (found === undefined) continue;
    manifests.push(path);
    found.forEach(add);
  }
  return { manifests, names, dynamic };
}

function fromPyproject(text: string): string[] {
  let doc: Record<string, any>;
  try {
    doc = parseToml(text) as Record<string, any>;
  } catch {
    return [];
  }
  const out: string[] = [];
  const list = (v: unknown) => {
    if (Array.isArray(v)) for (const item of v) if (typeof item === "string") out.push(item);
  };
  const table = (v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...Object.keys(v));
  };
  const lists = (v: unknown) => {
    if (v && typeof v === "object") Object.values(v).forEach(list);
  };

  list(doc.project?.dependencies);
  lists(doc.project?.["optional-dependencies"]);
  lists(doc["dependency-groups"]);
  const poetry = doc.tool?.poetry;
  table(poetry?.dependencies);
  table(poetry?.["dev-dependencies"]);
  if (poetry?.group) for (const g of Object.values(poetry.group)) table((g as any)?.dependencies);
  lists(doc.tool?.pdm?.["dev-dependencies"]);
  list(doc.tool?.uv?.["dev-dependencies"]);
  return out.filter((n) => normalizeDist(n) !== "python");
}

function fromRequirements(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    const egg = /#egg=([A-Za-z0-9._-]+)/.exec(raw);
    if (egg) out.push(egg[1]!);
    else if (!line.startsWith("-") && !/^[a-z+]+:\/\//.test(line)) out.push(line);
  }
  return out;
}

/** Paths of the files a requirements file includes with `-r` or `-c`, relative to the repository root. */
function includes(path: string, text: string): string[] {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = INCLUDE.exec(line);
    if (!m || /^[a-z+]+:\/\//.test(m[1]!)) continue;
    const parts: string[] = [];
    for (const part of `${dir}${m[1]}`.split("/")) {
      if (part === "..") parts.pop();
      else if (part !== "." && part !== "") parts.push(part);
    }
    out.push(parts.join("/"));
  }
  return out;
}

/** `[packages]` and `[dev-packages]` of a Pipfile. */
function fromPipfile(text: string): string[] {
  let doc: Record<string, any>;
  try {
    doc = parseToml(text) as Record<string, any>;
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const table of [doc.packages, doc["dev-packages"]]) {
    if (table && typeof table === "object") out.push(...Object.keys(table));
  }
  return out;
}

/**
 * The list items of a conda environment file, including its `pip:` list. Conda
 * package names mostly match PyPI names; where they do not, the extra name can
 * only hide a finding.
 */
function fromEnvironmentYml(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*-\s+([A-Za-z0-9][A-Za-z0-9._-]*)(?:\s*[=<>!~\[]|\s*$)/.exec(line);
    if (m && !/:\s*$/.test(line)) out.push(m[1]!.replace(/^conda-forge::/, ""));
  }
  return out;
}

function fromSetupCfg(text: string): string[] {
  const out: string[] = [];
  let section = "";
  let collecting = false;
  for (const line of text.split("\n")) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) {
      section = header[1]!.trim();
      collecting = false;
      continue;
    }
    if (/^\s/.test(line)) {
      const item = line.trim();
      if (collecting && item && !item.startsWith("#")) out.push(item);
      continue;
    }
    const kv = /^([\w.-]+)\s*[=:]\s*(.*)$/.exec(line);
    collecting =
      !!kv &&
      ((section === "options" && /^(install_requires|tests_require)$/.test(kv[1]!)) ||
        section === "options.extras_require");
    if (collecting && kv![2]!.trim()) out.push(kv![2]!.trim());
  }
  return out;
}

/**
 * Every requirement-shaped string literal in setup.py. Lists are often built
 * in variables, with `+` or behind conditions, so reading only the literal
 * after `install_requires=` misses declarations; reading more strings than
 * needed can only hide a finding, never invent one.
 */
function fromSetupPy(text: string): string[] {
  const out: string[] = [];
  for (const s of text.matchAll(/(["'])([A-Za-z0-9][A-Za-z0-9._-]*(?:\[[\w,\s-]*\])?\s*(?:[<>=!~;@][^"'\n]*)?)\1/g)) {
    out.push(s[2]!);
  }
  return out;
}

/** A dependency argument of setup() that is neither a literal nor a variable assigned a literal in the file. */
function setupPyIsDynamic(text: string): boolean {
  for (const m of text.matchAll(/\b(install_requires|extras_require|tests_require)\s*=\s*([^\s,)]+)/g)) {
    const value = m[2]!;
    if (/^[[{]/.test(value)) continue;
    if (/^[A-Za-z_]\w*$/.test(value) && new RegExp(`^${value}\\s*=\\s*[[{]`, "m").test(text)) continue;
    return true;
  }
  return false;
}
