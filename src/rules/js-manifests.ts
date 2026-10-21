import type { DiffContext } from "../types.js";

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

interface PackageJson {
  path: string;
  dir: string;
  names: Set<string>;
}

export interface JsManifests {
  /** The package.json files that apply to a source file, nearest first. */
  forFile(path: string): PackageJson[];
  /** Names of the packages in the repository itself (workspaces). */
  local: Set<string>;
  /** Prefixes declared as path aliases in tsconfig or jsconfig `paths`. */
  aliases: string[];
}

/** Every package.json at head, with the dependencies and names it declares. */
export function jsManifests(ctx: DiffContext): JsManifests {
  const packages: PackageJson[] = [];
  const local = new Set<string>();
  const aliases: string[] = [];
  for (const path of ctx.listHead()) {
    const base = path.split("/").pop()!;
    if (base === "package.json") {
      const json = parseJson(ctx.readHead(path));
      if (!json) continue;
      const names = new Set<string>();
      for (const field of DEPENDENCY_FIELDS) {
        const deps = json[field];
        if (deps && typeof deps === "object") Object.keys(deps).forEach((n) => names.add(n));
      }
      if (typeof json.name === "string") {
        names.add(json.name);
        local.add(json.name);
      }
      packages.push({ path, dir: path.slice(0, -base.length), names });
    } else if (/^[jt]sconfig[\w.-]*\.json$/.test(base)) {
      aliases.push(...pathAliases(ctx.readHead(path) ?? ""));
    }
  }
  return {
    forFile: (file) => packages.filter((p) => file.startsWith(p.dir)).sort((a, b) => b.dir.length - a.dir.length),
    local,
    aliases,
  };
}

function parseJson(text: string | undefined): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text ?? "");
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keys of `compilerOptions.paths`, read loosely because tsconfig allows
 * comments and trailing commas: `"@app/*": [...]` gives `@app/`.
 */
function pathAliases(text: string): string[] {
  const at = text.search(/"paths"\s*:\s*\{/);
  if (at < 0) return [];
  const body = text.slice(text.indexOf("{", at) + 1, text.indexOf("}", at));
  return [...body.matchAll(/"([^"]+)"\s*:\s*\[/g)].map((m) => m[1]!.replace(/\*$/, ""));
}
