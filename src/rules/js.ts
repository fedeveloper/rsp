// Line-level helpers for JavaScript and TypeScript source. Like the Python
// helpers they read single lines plus indentation, not a syntax tree.

export const JS_FILE = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts|vue|svelte)$/;

const STATIC_IMPORTS = [
  /^\s*import\s+(?:type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/,
  /^\s*import\s*['"]([^'"]+)['"]/,
  /^\s*export\s+(?:type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/,
  // Closing line of a multi-line import or export: `} from "pkg";`
  /^\s*\}\s*from\s*['"]([^'"]+)['"]/,
];
const REQUIRE = /(?<![\w.$])require\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Package specifiers a line imports with `import`, `export ... from` or
 * `require()`. Dynamic `import()` is left out: it is the usual way to load an
 * optional package.
 */
export function importedSpecifiers(line: string): string[] {
  if (isCommentLine(line)) return [];
  const specs: string[] = [];
  for (const re of STATIC_IMPORTS) {
    const m = re.exec(line);
    if (m) specs.push(m[1]!);
  }
  // A require() inside a string literal is text, not a call.
  const code = blankStrings(line);
  for (const m of line.matchAll(REQUIRE)) {
    if (code.startsWith("require(", m.index)) specs.push(m[1]!);
  }
  return specs;
}

/**
 * The npm package a specifier refers to, or undefined for relative paths,
 * Node built-ins, URLs and other protocols (`node:`, `npm:`, `virtual:`), subpath
 * imports (`#x`) and common path aliases (`@/x`, `~/x`, `$lib`).
 */
export function packageName(spec: string): string | undefined {
  if (/^[./]/.test(spec) || spec.includes(":") || /^[#~$]/.test(spec) || spec.startsWith("@/")) return undefined;
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  return /^(@[\w.-]+\/)?[\w.-]+$/.test(name) ? name : undefined;
}

/**
 * True when the line sits inside a `try` or `catch` block, found by walking up
 * to each line with less indentation.
 */
export function isInTryBlock(lines: string[], index: number): boolean {
  let indent = indentation(lines[index] ?? "");
  for (let i = index - 1; i >= 0 && indent > 0; i--) {
    const l = lines[i]!;
    if (l.trim() === "" || isCommentLine(l)) continue;
    const ind = indentation(l);
    if (ind < indent) {
      if (/^(\}\s*)?(try|catch\b[^{]*)\s*\{\s*$/.test(l.trim())) return true;
      indent = ind;
    }
  }
  return false;
}

const ENV_READS = [
  /\b(?:process\.env|import\.meta\.env|Bun\.env)\??\.([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*(?:=[^=]|\?\?=|\|\|=|&&=))/g,
  /\b(?:process\.env|import\.meta\.env|Bun\.env)\??\.?\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\](?!\s*(?:=[^=]|\?\?=|\|\|=|&&=))/g,
  /\bDeno\.env\.get\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g,
];
const ENV_DESTRUCTURE = /\{([^{}]*)\}\s*=\s*(?:process\.env|import\.meta\.env|Bun\.env)\b/;

// Set by Vite on import.meta.env, never by the user.
const VITE_BUILTINS = new Set(["MODE", "BASE_URL", "PROD", "DEV", "SSR"]);

/** Names of environment variables a line reads by literal name. */
export function envVarReads(line: string): string[] {
  if (isCommentLine(line)) return [];
  const code = line.replace(/\/\/.*$/, "");
  const blank = blankStrings(code);
  const names: string[] = [];
  for (const re of ENV_READS) {
    for (const m of code.matchAll(re)) {
      // A read inside a string literal is text, not a read.
      if (blank.startsWith(m[0].slice(0, 4), m.index)) names.push(m[1]!);
    }
  }
  const d = ENV_DESTRUCTURE.exec(code);
  if (d) {
    for (const part of d[1]!.split(",")) {
      const name = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(part)?.[1];
      if (name) names.push(name);
    }
  }
  return code.includes("import.meta.env") ? names.filter((n) => !VITE_BUILTINS.has(n)) : names;
}

/**
 * 1-based numbers of the lines that start inside a template literal or a block
 * comment, such as source code embedded in a test as a string. A small scanner,
 * not a parser: regular expression literals are not recognized.
 */
export function nonCodeLines(text: string): Set<number> {
  const result = new Set<number>();
  // Each entry is a template literal or a `${` expression inside one.
  const stack: ("template" | number)[] = [];
  let state: "code" | "line-comment" | "block-comment" | "'" | '"' = "code";
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const top = stack[stack.length - 1];
    if (c === "\n") {
      line++;
      // Quotes cannot span lines; resetting also recovers from a quote in a regex literal.
      if (state === "line-comment" || state === "'" || state === '"') state = "code";
      if (state === "block-comment" || (state === "code" && top === "template")) result.add(line);
      continue;
    }
    if (state === "line-comment") continue;
    if (state === "block-comment") {
      if (c === "*" && text[i + 1] === "/") {
        state = "code";
        i++;
      }
      continue;
    }
    if (state === "'" || state === '"') {
      if (c === "\\") i++;
      else if (c === state) state = "code";
      continue;
    }
    if (top === "template") {
      if (c === "\\") i++;
      else if (c === "`") stack.pop();
      else if (c === "$" && text[i + 1] === "{") {
        stack.push(0);
        i++;
      }
      continue;
    }
    if (c === "/" && text[i + 1] === "/") state = "line-comment";
    else if (c === "/" && text[i + 1] === "*") {
      state = "block-comment";
      i++;
    }
    else if (c === "'" || c === '"') state = c;
    else if (c === "`") stack.push("template");
    else if (typeof top === "number" && c === "{") stack[stack.length - 1] = top + 1;
    else if (typeof top === "number" && c === "}") {
      if (top === 0) stack.pop();
      else stack[stack.length - 1] = top - 1;
    }
  }
  return result;
}

/**
 * The line with the contents of its string literals replaced by spaces, so that
 * `"// eslint-disable"` or `"require('x')"` in a string are not read as code.
 * Lengths are kept, so indexes still point into the original line. A trailing
 * comment and `${...}` expressions in template literals are kept as they are.
 */
export function blankStrings(line: string): string {
  let out = "";
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === "\\") {
        out += "  ";
        i++;
      } else if (c === quote) {
        out += c;
        quote = undefined;
      } else if (quote === "`" && c === "$" && line[i + 1] === "{") {
        // A `${...}` expression in a template literal is code: keep it.
        const end = closingBrace(line, i + 2);
        out += line.slice(i, end + 1);
        i = end;
      } else {
        out += " ";
      }
    } else if (c === "/" && (line[i + 1] === "/" || line[i + 1] === "*")) {
      return out + line.slice(i);
    } else {
      if (c === "'" || c === '"' || c === "`") quote = c;
      out += c;
    }
  }
  return out;
}

/** Index of the `}` closing a brace opened before `from`, or the last index. */
function closingBrace(line: string, from: number): number {
  let depth = 0;
  for (let i = from; i < line.length; i++) {
    if (line[i] === "{") depth++;
    else if (line[i] === "}" && depth-- === 0) return i;
  }
  return line.length - 1;
}

export function isCommentLine(line: string): boolean {
  return /^\s*(\/\/|\/\*|\*)/.test(line);
}

function indentation(line: string): number {
  return line.length - line.trimStart().length;
}
