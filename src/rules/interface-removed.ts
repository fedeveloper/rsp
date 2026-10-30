import type { DiffContext, FileChange, RawFinding, Rule } from "../types.js";
import { JS_FILE, nonCodeLines } from "./js.js";
import { isGuardedImport, stringLines } from "./python.js";
import { codeSpan } from "../text.js";

const PY_TOP_DEFINITION = /^(?:async\s+def|def|class)\s+([A-Za-z_]\w*)|^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/;
const JS_EXPORTED = [
  /^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*?|class|const|let|var|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/,
];
const JS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export const interfaceRemoved: Rule = {
  id: "interface/removed-still-used",
  version: "0.1.0",
  keys: "the file and the name, e.g. `app/config.py:load_settings`",
  description:
    "Top-level functions, classes and constants (Python) or exports (JavaScript/TypeScript) that the diff removes " +
    "from a module while another file still imports them by name at head.",
  run(ctx) {
    const removed = new Map<string, Set<string>>();
    for (const file of ctx.files) {
      if (file.binary || file.status !== "modified") continue;
      const names = file.path.endsWith(".py") ? removedPython(ctx, file) : JS_FILE.test(file.path) && !/\.(vue|svelte)$/.test(file.path) ? removedJs(ctx, file) : undefined;
      if (names && names.size > 0) removed.set(file.path, names);
    }
    if (removed.size === 0) return [];

    const head = ctx.listHead();
    const findings: RawFinding[] = [];
    for (const importer of head) {
      const isPy = importer.endsWith(".py");
      const isJs = JS_FILE.test(importer);
      if (!isPy && !isJs) continue;
      const text = ctx.readHead(importer);
      if (text === undefined) continue;
      const imports = isPy ? pythonImports(text, importer, head) : jsImports(text, importer, head);
      for (const imp of imports) {
        if (imp.module === importer) continue;
        const names = removed.get(imp.module);
        if (!names?.has(imp.name)) continue;
        findings.push({
          key: `${imp.module}:${imp.name}`,
          message: `Imports ${codeSpan(imp.name)} from ${codeSpan(imp.module)}, which no longer defines it`,
          locations: [{ path: importer, line: imp.line }],
          evidence: imp.evidence,
        });
      }
    }
    return findings;
  },
};

/** Whether `name` occurs as a word anywhere in the text: then it may still be defined, re-exported or assigned. */
function mentions(text: string, name: string): boolean {
  return new RegExp(`(^|[^\\w$])${name.replace(/\$/g, "\\$")}($|[^\\w$])`).test(text);
}

/**
 * Names defined at the top level of a Python module at base and absent from it
 * at head. Silent for modules that can define names dynamically.
 */
function removedPython(ctx: DiffContext, file: FileChange): Set<string> {
  const before = ctx.readBase(file.oldPath) ?? "";
  const after = ctx.readHead(file.path) ?? "";
  const out = new Set<string>();
  if (/^def\s+__getattr__\b|^from\s+\S+\s+import\s+\*|^\s*globals\(\)/m.test(after)) return out;
  const deleted = new Set(file.lines.filter((l) => l.kind === "del").map((l) => l.oldLine));
  const inStrings = stringLines(before);
  before.split("\n").forEach((line, i) => {
    if (!deleted.has(i + 1) || inStrings.has(i + 1)) return;
    const m = PY_TOP_DEFINITION.exec(line);
    const name = m?.[1] ?? m?.[2];
    if (name && name !== "__all__" && !mentions(after, name)) out.add(name);
  });
  // A package's submodule is importable by name from the package whatever its __init__.py says.
  if (file.path.endsWith("/__init__.py")) {
    const dir = file.path.slice(0, -"__init__.py".length);
    for (const p of ctx.listHead()) {
      if (!p.startsWith(dir)) continue;
      const sub = p.slice(dir.length).split("/")[0]!.replace(/\.py$/, "");
      out.delete(sub);
    }
  }
  return out;
}

/** Names exported by a JavaScript/TypeScript module at base and no longer mentioned at head. */
function removedJs(ctx: DiffContext, file: FileChange): Set<string> {
  const before = ctx.readBase(file.oldPath) ?? "";
  const after = ctx.readHead(file.path) ?? "";
  const out = new Set<string>();
  // Wildcard re-exports and CommonJS exports can provide any name.
  if (/^\s*export\s*\*|module\.exports|^\s*exports\./m.test(after)) return out;
  const deleted = new Set(file.lines.filter((l) => l.kind === "del").map((l) => l.oldLine));
  const nonCode = nonCodeLines(before);
  before.split("\n").forEach((line, i) => {
    if (!deleted.has(i + 1) || nonCode.has(i + 1)) return;
    if (/^\s*export\s+default\b/.test(line) && !/^\s*export\s+default\b|\bas\s+default\b/m.test(after)) out.add("default");
    for (const re of JS_EXPORTED) {
      const name = re.exec(line)?.[1];
      if (name && !mentions(after, name)) out.add(name);
    }
  });
  return out;
}

interface NamedImport {
  /** Repository path of the module the name is imported from. */
  module: string;
  name: string;
  line: number;
  evidence: string;
}

/** The single file a module path resolves to at head, or undefined when there is none or more than one. */
function unique(candidates: string[], head: Set<string>): string | undefined {
  const found = [...new Set(candidates.filter((c) => head.has(c)))];
  return found.length === 1 ? found[0] : undefined;
}

function normalize(path: string): string | undefined {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}

/** `from module import a, b as c` statements, including parenthesized ones over several lines. */
function pythonImports(text: string, importer: string, headList: string[]): NamedImport[] {
  const head = new Set(headList);
  const lines = text.split("\n");
  const inStrings = stringLines(text);
  const dir = importer.includes("/") ? importer.slice(0, importer.lastIndexOf("/")) : "";
  const out: NamedImport[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*from\s+(\.*)([\w.]*)\s+import\s+(.*)$/.exec(lines[i]!.replace(/#.*$/, ""));
    if (!m || inStrings.has(i + 1) || isGuardedImport(lines, i)) continue;
    const [, dots, dotted, rest] = m;
    let base: string[];
    if (dots) {
      let up = dir;
      for (let d = 1; d < dots.length; d++) up = up.includes("/") ? up.slice(0, up.lastIndexOf("/")) : "";
      const rel = [up, dotted!.replace(/\./g, "/")].filter(Boolean).join("/");
      base = [rel];
    } else {
      const path = dotted!.replace(/\./g, "/");
      base = [path, `src/${path}`];
    }
    const module = unique(base.flatMap((b) => [`${b}.py`, `${b}/__init__.py`]), head);
    if (!module) continue;
    // The names, with the line each one is on.
    const parts: { text: string; line: number }[] = [{ text: rest!, line: i }];
    if (rest!.trim().startsWith("(") && !rest!.includes(")")) {
      for (let j = i + 1; j < lines.length; j++) {
        parts.push({ text: lines[j]!.replace(/#.*$/, ""), line: j });
        if (lines[j]!.includes(")")) break;
      }
    } else if (rest!.trim().endsWith("\\")) {
      for (let j = i + 1; j < lines.length; j++) {
        parts.push({ text: lines[j]!, line: j });
        if (!lines[j]!.trim().endsWith("\\")) break;
      }
    }
    for (const part of parts) {
      for (const item of part.text.replace(/[()\\]/g, "").split(",")) {
        const name = item.trim().split(/\s+/)[0];
        if (name && /^[A-Za-z_]\w*$/.test(name)) {
          out.push({ module, name, line: part.line + 1, evidence: lines[part.line]!.trim() });
        }
      }
    }
  }
  return out;
}

/** Named and default imports, and named re-exports, from relative paths. */
function jsImports(text: string, importer: string, headList: string[]): NamedImport[] {
  const head = new Set(headList);
  const lines = text.split("\n");
  const nonCode = nonCodeLines(text);
  const dir = importer.includes("/") ? importer.slice(0, importer.lastIndexOf("/")) : "";
  const out: NamedImport[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (nonCode.has(i + 1) || !/^\s*(import|export)\b/.test(lines[i]!)) continue;
    // The whole statement, up to the line with `from "..."`.
    let end = i;
    while (end < lines.length - 1 && end - i < 50 && !/\bfrom\s*['"][^'"]+['"]/.test(lines[end]!) && !/;\s*$/.test(lines[end]!)) end++;
    // A statement that runs into a string or template literal is not an import.
    let inText = false;
    for (let j = i + 1; j <= end; j++) inText ||= nonCode.has(j + 1);
    if (inText) continue;
    const statement = lines.slice(i, end + 1).join("\n");
    const m = /^\s*(import|export)\s+(?:type\s+)?([\s\S]*?)\s*\bfrom\s*['"](\.{1,2}\/[^'"]*)['"]/.exec(statement);
    if (!m) continue;
    const [, keyword, clause, spec] = m;
    const target = normalize([dir, spec!].filter(Boolean).join("/"));
    if (target === undefined) continue;
    const stem = target.replace(/\.(m|c)?js$/, "");
    const module = unique(
      [target, ...JS_EXTENSIONS.map((e) => `${stem}${e}`), ...JS_EXTENSIONS.map((e) => `${target}/index${e}`)],
      head,
    );
    if (!module) continue;
    const at = (name: string) => {
      for (let j = i; j <= end; j++) {
        if (mentions(lines[j]!, name)) return j;
      }
      return i;
    };
    const names: string[] = [];
    const braces = /\{([^}]*)\}/.exec(clause!);
    if (braces) {
      for (const item of braces[1]!.split(",")) {
        const name = item.trim().replace(/^type\s+/, "").split(/\s+/)[0];
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.push(name === "default" ? "default" : name);
      }
    }
    // `import Thing from "./x"` takes the default export.
    if (keyword === "import" && /^[A-Za-z_$][\w$]*\s*(,|$)/.test(clause!.trim())) names.push("default");
    for (const name of names) {
      const line = name === "default" ? i : at(name);
      out.push({ module, name, line: line + 1, evidence: lines[line]!.trim() });
    }
    i = end;
  }
  return out;
}
