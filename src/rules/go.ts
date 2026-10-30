// Go helpers: string and comment scanning, imports, environment reads, and
// the parts of go.mod, go.work and go.sum the rules compare. Read with small
// scanners, like the other languages; anything unexpected yields nothing.
import type { DiffContext } from "../types.js";

export const GO_FILE = /\.go$/;
export const GO_TEST_FILE = /_test\.go$/;

/** Lines that lie entirely inside a raw string literal or a block comment, 1-based. */
export function goNonCodeLines(text: string): Set<number> {
  const out = new Set<number>();
  let line = 1;
  let state: "code" | "raw" | "block" | "string" | "rune" | "line-comment" = "code";
  let lineHasCode = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "\n") {
      if ((state === "raw" || state === "block") && !lineHasCode) out.add(line);
      if (state === "line-comment" || state === "string" || state === "rune") state = "code";
      line++;
      lineHasCode = false;
      continue;
    }
    if (state === "code") {
      if (c === "/" && text[i + 1] === "/") state = "line-comment";
      else if (c === "/" && text[i + 1] === "*") {
        state = "block";
        i++;
      } else if (c === "`") state = "raw";
      else if (c === '"') state = "string";
      else if (c === "'") state = "rune";
      if (state === "code" && !/\s/.test(c)) lineHasCode = true;
      if (state !== "code") lineHasCode = true;
    } else if (state === "raw") {
      if (c === "`") {
        state = "code";
        lineHasCode = true;
      }
    } else if (state === "block") {
      if (c === "*" && text[i + 1] === "/") {
        state = "code";
        lineHasCode = true;
        i++;
      }
    } else if (state === "string" || state === "rune") {
      if (c === "\\") i++;
      else if ((state === "string" && c === '"') || (state === "rune" && c === "'")) state = "code";
    }
  }
  return out;
}

/** The line with the contents of its string and rune literals blanked, so text in strings matches no pattern. */
export function blankGoStrings(line: string): string {
  return line.replace(/"(?:[^"\\]|\\.)*"|`[^`]*`|'(?:[^'\\]|\\.)*'/g, (m) => m[0]! + m[m.length - 1]!);
}

export interface GoImport {
  path: string;
  /** 1-based line of the import spec. */
  line: number;
}

/** Import paths of a Go file with their lines: `import "x"`, `import y "x"` and `import ( ... )` blocks. */
export function goImports(text: string): GoImport[] {
  const lines = text.split("\n");
  const nonCode = goNonCodeLines(text);
  const out: GoImport[] = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (nonCode.has(i + 1)) continue;
    const line = lines[i]!.replace(/\/\/.*$/, "");
    if (inBlock) {
      if (/^\s*\)/.test(line)) {
        inBlock = false;
        continue;
      }
      const m = /^\s*(?:[\w.]+\s+)?"([^"]+)"\s*;?\s*$/.exec(line);
      if (m) out.push({ path: m[1]!, line: i + 1 });
      continue;
    }
    if (/^import\s*\(\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    const single = /^import\s+(?:[\w.]+\s+)?"([^"]+)"\s*;?\s*$/.exec(line);
    if (single) out.push({ path: single[1]!, line: i + 1 });
    // Imports come first; the first declaration ends them.
    if (/^(func|type|var|const)\b/.test(line)) break;
  }
  return out;
}

/** Whether an import path is in the standard library: its first element has no dot. */
export function isGoStdlib(path: string): boolean {
  return path === "C" || !path.split("/")[0]!.includes(".");
}

/** Environment variables read by literal name on one line. */
export function goEnvReads(line: string): string[] {
  return [...line.matchAll(/\b(?:os\.(?:Getenv|LookupEnv)|syscall\.Getenv)\(\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*\)/g)].map((m) => m[1]!);
}

export interface GoMod {
  /** Repository path of the go.mod file. */
  path: string;
  module: string;
  /** Required module path to version, direct and indirect. */
  require: Map<string, string>;
  /** Module paths replaced, and whether the replacement is a local directory. */
  replace: Map<string, { local: boolean }>;
  /** 1-based line of each `require` entry by module path. */
  lines: Map<string, number>;
}

/** go.mod: `module`, `require` and `replace`, single-line or in blocks. Undefined without a module line. */
export function parseGoMod(text: string, path: string): GoMod | undefined {
  const mod: GoMod = { path, module: "", require: new Map(), replace: new Map(), lines: new Map() };
  let block: string | undefined;
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) return;
    if (block) {
      if (line === ")") block = undefined;
      else entry(block, line, i + 1);
      return;
    }
    const m = /^(module|require|replace|exclude|retract|go|toolchain|godebug|tool|ignore)\b\s*(.*)$/.exec(line);
    if (!m) return;
    if (m[2] === "(") block = m[1];
    else entry(m[1]!, m[2]!, i + 1);
  });
  return mod.module ? mod : undefined;

  function entry(kind: string, rest: string, n: number) {
    const words = rest.split(/\s+/).map(unquote);
    if (kind === "module") mod.module = words[0] ?? "";
    else if (kind === "require" && words[0] && words[1]) {
      mod.require.set(words[0], words[1]);
      mod.lines.set(words[0], n);
    } else if (kind === "replace") {
      const arrow = words.indexOf("=>");
      const target = words[arrow + 1];
      if (arrow > 0 && target) mod.replace.set(words[0]!, { local: /^\.{0,2}\//.test(target) });
    }
  }
}

function unquote(s: string): string {
  return s.replace(/^"(.*)"$/, "$1");
}

/** Every go.mod at head, parsed, with go.work `use` directories noted by the caller. */
export function goModules(ctx: DiffContext): GoMod[] {
  return ctx
    .listHead()
    .filter((p) => p === "go.mod" || p.endsWith("/go.mod"))
    .flatMap((p) => parseGoMod(ctx.readHead(p) ?? "", p) ?? []);
}

/** The go.mod whose directory is the nearest one containing `file`. */
export function moduleFor(mods: GoMod[], file: string): GoMod | undefined {
  let best: GoMod | undefined;
  for (const m of mods) {
    const dir = m.path.slice(0, -"go.mod".length);
    if (file.startsWith(dir) && (!best || dir.length > best.path.length - "go.mod".length)) best = m;
  }
  return best;
}

/** `path version` pairs listed in a go.sum, for a module's code or its go.mod. */
export function goSumEntries(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split("\n")) {
    const [path, version] = line.trim().split(/\s+/);
    if (path && version) out.add(`${path} ${version.replace(/\/go\.mod$/, "")}`);
  }
  return out;
}
