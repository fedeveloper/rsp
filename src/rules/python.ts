// Line-level helpers for Python source. They work on single lines plus
// indentation, which is enough for the statements the rules look at.

const IMPORT = /^\s*import\s+(.+)$/;
const FROM_IMPORT = /^\s*from\s+([\w.]+)\s+import\b/;

/** Top-level module names a line imports; relative imports are skipped. */
export function importedModules(line: string): string[] {
  const code = stripComment(line);
  const from = FROM_IMPORT.exec(code);
  if (from) return from[1]!.startsWith(".") ? [] : [from[1]!.split(".")[0]!];
  const imp = IMPORT.exec(code);
  if (!imp) return [];
  return imp[1]!
    .replace(/[()\\]/g, "")
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0]!.split(".")[0]!)
    .filter((name) => /^[A-Za-z_]\w*$/.test(name));
}

interface Header {
  index: number;
  text: string;
}

/**
 * Header lines of the blocks that contain `lines[index]` (0-based), innermost
 * first, found by walking up to each code line with less indentation.
 */
export function enclosingHeaders(lines: string[], index: number): Header[] {
  const headers: Header[] = [];
  let indent = indentation(lines[index] ?? "");
  for (let i = index - 1; i >= 0 && indent > 0; i--) {
    const l = lines[i]!;
    if (l.trim() === "" || l.trim().startsWith("#")) continue;
    const ind = indentation(l);
    if (ind < indent) {
      headers.push({ index: i, text: l.trim() });
      indent = ind;
    }
  }
  return headers;
}

const TYPE_CHECKING_IF = /^if\s+(?:[\w.]+\.)?TYPE_CHECKING\b/;

/**
 * True when the line sits inside `if TYPE_CHECKING:` (also `typing.` or an alias
 * such as `t.`), or in the `try`, `except` or `else` part of a try statement.
 */
export function isGuardedImport(lines: string[], index: number): boolean {
  return enclosingHeaders(lines, index).some(
    (h) => TYPE_CHECKING_IF.test(h.text) || /^(try|except\b.*|finally)\s*:/.test(h.text) || isTryElse(lines, h),
  );
}

/** True for an `else:` that belongs to a try statement rather than an if or a loop. */
function isTryElse(lines: string[], header: Header): boolean {
  if (!/^else\s*:/.test(header.text)) return false;
  const indent = indentation(lines[header.index]!);
  for (let i = header.index - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (l.trim() === "" || indentation(l) > indent) continue;
    return /^except\b/.test(l.trim());
  }
  return false;
}

/**
 * Modules a file treats as optional: imported somewhere under a guard. Imports
 * of them elsewhere in the file (`if has_simplejson: from simplejson ...`) are
 * optional too.
 */
export function optionalModules(lines: string[]): Set<string> {
  const names = new Set<string>();
  lines.forEach((line, i) => {
    if (isGuardedImport(lines, i)) importedModules(line).forEach((m) => names.add(m));
  });
  return names;
}

const ENV_READS = [
  /\b(?:os\.)?getenv\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  /\b(?:os\.)?environ\.get\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  /\b(?:os\.)?environ\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\](?!\s*=[^=])/g,
];

/** Names of environment variables a line reads by literal name. */
export function envVarReads(line: string): string[] {
  const code = stripComment(line);
  const names: string[] = [];
  for (const re of ENV_READS) {
    for (const m of code.matchAll(re)) names.push(m[1]!);
  }
  return names;
}

/** PEP 503 name normalization. */
export function normalizeDist(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

function indentation(line: string): number {
  return line.length - line.trimStart().length;
}

/** Drops a trailing `#` comment, ignoring `#` inside simple string literals. */
function stripComment(line: string): string {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * 1-based numbers of the lines that start inside a triple-quoted string, such
 * as a docstring or source code written to a file by a test. Their content is
 * text, not statements.
 */
export function stringLines(text: string): Set<number> {
  const out = new Set<number>();
  let line = 1;
  let quote: string | undefined; // the closing delimiter of the open string
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "\n") {
      line++;
      if (quote && quote.length === 1) quote = undefined; // unterminated single-line string
      if (quote) out.add(line);
      continue;
    }
    if (quote) {
      // A backslash before a newline continues the string; the newline still counts.
      if (c === "\\" && text[i + 1] !== "\n") i++;
      else if (text.startsWith(quote, i)) {
        i += quote.length - 1;
        quote = undefined;
      }
    } else if (c === "#") {
      while (i + 1 < text.length && text[i + 1] !== "\n") i++;
    } else if (c === '"' || c === "'") {
      quote = text.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      i += quote.length - 1;
    }
  }
  return out;
}

/**
 * The line with the contents of its string literals replaced by spaces, so
 * that patterns match code and comments only. A string left open at the end of
 * the line is blanked to the end.
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
      } else if (line.startsWith(quote, i)) {
        out += quote;
        i += quote.length - 1;
        quote = undefined;
      } else out += " ";
    } else if (c === "#") {
      return out + line.slice(i);
    } else if (c === '"' || c === "'") {
      quote = line.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      out += quote;
      i += quote.length - 1;
    } else out += c;
  }
  return out;
}
