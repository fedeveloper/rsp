import { parse as parseToml } from "smol-toml";
import type { DiffContext } from "../types.js";
import { normalizeDist } from "./python.js";

export interface DeclaredDeps {
  /** Manifest paths that were read. */
  manifests: string[];
  /** Normalized distribution names declared in any of them. */
  names: Set<string>;
}

const REQUIREMENTS = /(^|\/)(requirements[^/]*\.(txt|in)|requirements\/[^/]+\.(txt|in))$/;
const REQUIREMENT_NAME = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/;

/**
 * Every dependency declared at head, across pyproject.toml (PEP 621, PEP 735,
 * Poetry, PDM, uv), requirements files, setup.cfg and literal lists in setup.py.
 */
export function declaredDependencies(ctx: DiffContext): DeclaredDeps {
  const manifests: string[] = [];
  const names = new Set<string>();
  const add = (requirement: string) => {
    const m = REQUIREMENT_NAME.exec(requirement);
    if (m) names.add(normalizeDist(m[1]!));
  };

  for (const path of ctx.listHead()) {
    const base = path.split("/").pop()!;
    let found: string[] | undefined;
    if (base === "pyproject.toml") found = fromPyproject(ctx.readHead(path) ?? "");
    else if (REQUIREMENTS.test(path)) found = fromRequirements(ctx.readHead(path) ?? "");
    else if (base === "setup.cfg") found = fromSetupCfg(ctx.readHead(path) ?? "");
    else if (base === "setup.py") found = fromSetupPy(ctx.readHead(path) ?? "");
    if (found === undefined) continue;
    manifests.push(path);
    found.forEach(add);
  }
  return { manifests, names };
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

function fromSetupPy(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(install_requires|tests_require|extras_require)\s*=\s*([[{][^\]}]*[\]}])/g)) {
    for (const s of m[2]!.matchAll(/["']([^"']+)["']/g)) out.push(s[1]!);
  }
  return out;
}
