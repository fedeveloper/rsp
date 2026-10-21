// Public function signatures of Python and JavaScript/TypeScript files, reduced
// to what callers depend on: parameter names, order, optionality and defaults.
// Type annotations are left out, so adding type hints is not an interface change.

export interface Signature {
  /** `name`, or `Class.name` for a method. */
  name: string;
  /** Parameters as callers see them, e.g. `["path", "strict=False"]`; overloads are joined with `|`. */
  params: string[];
  /** What callers depend on; for JavaScript, positional parameter names are left out. */
  shape: string;
  /** 1-based line of the definition. */
  line: number;
}

const PY_DEF = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
const PY_CLASS = /^class\s+([A-Za-z_]\w*)\b/;

/** Public top-level functions and methods of public top-level classes. */
export function pythonSignatures(text: string): Signature[] {
  const lines = text.split("\n");
  const out: Signature[] = [];
  let cls: string | undefined;
  lines.forEach((line, i) => {
    if (/^\S/.test(line) && !/^(@|#|\)|\])/.test(line)) {
      cls = PY_CLASS.exec(line)?.[1];
    }
    const m = PY_DEF.exec(line);
    if (!m) return;
    const indented = m[1]!.length > 0;
    const name = m[2]!;
    if (indented && !cls) return;
    if (cls && indented && m[1]!.length !== 4 && m[1] !== "\t") return;
    if (!indented) cls = undefined;
    const owner = indented ? cls : undefined;
    if (owner?.startsWith("_") || (name.startsWith("_") && name !== "__init__")) return;
    const raw = paramsFrom(lines, i, line.indexOf("(", m[0].length - 1), "#");
    if (raw === undefined) return;
    let params = splitParams(raw).map(pythonParam).filter((p) => p !== "");
    // `self` and `cls` are supplied by Python, not by callers.
    if (owner && (params[0] === "self" || params[0] === "cls")) params = params.slice(1);
    out.push({ name: owner ? `${owner}.${name}` : name, params, shape: params.join(", "), line: i + 1 });
  });
  return mergeOverloads(out);
}

const JS_EXPORTED = [
  /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^(]*>)?\s*\(/,
  /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\s*\*?\s*[\w$]*\s*)?(?:<[^(]*>)?\s*\(/,
];

/** Exported functions, including arrow functions assigned to exported constants. */
export function jsSignatures(text: string): Signature[] {
  const lines = text.split("\n");
  const out: Signature[] = [];
  lines.forEach((line, i) => {
    for (const re of JS_EXPORTED) {
      const m = re.exec(line);
      if (!m) continue;
      // The arrow function's own parameter list, not a call on the right-hand side.
      if (re === JS_EXPORTED[1] && !isArrowOrFunction(lines, i, m[0].length - 1)) continue;
      const raw = paramsFrom(lines, i, m[0].length - 1, "//");
      if (raw === undefined) continue;
      const params = splitParams(raw).map(jsParam).filter((p) => p !== "" && p !== "this");
      // Arguments are passed by position, so renaming a plain parameter changes nothing for callers.
      const shape = params.map((p) => p.replace(/^(\.\.\.)?[A-Za-z_$][\w$]*/, "$1_")).join(", ");
      out.push({ name: m[1]!, params, shape, line: i + 1 });
      break;
    }
  });
  return mergeOverloads(out);
}

/**
 * Overloads declare one name several times; callers see all of them. Overloads
 * that differ only in annotations have the same shape and count once, so adding
 * typed overloads of an unchanged function is no change.
 */
function mergeOverloads(sigs: Signature[]): Signature[] {
  const byName = new Map<string, Signature & { shapes: Set<string> }>();
  for (const s of sigs) {
    const prev = byName.get(s.name);
    if (!prev) byName.set(s.name, { ...s, shapes: new Set([s.shape]) });
    else if (!prev.shapes.has(s.shape)) {
      prev.shapes.add(s.shape);
      byName.set(s.name, { ...prev, params: [...prev.params, "|", ...s.params], shape: `${prev.shape} | ${s.shape}` });
    }
  }
  return [...byName.values()].map(({ shapes: _, ...s }) => s);
}

/**
 * The difference between two parameter lists in words: added and removed
 * parameters, changed defaults, or a changed order.
 */
export function describeChange(before: string[], after: string[], positional = false): string {
  if (before.includes("|") || after.includes("|")) return `went from \`${overloads(before)}\` to \`${overloads(after)}\``;
  if (positional) return describePositional(before, after);
  const name = (p: string) => p.split("=")[0]!.replace(/\?$/, "");
  const old = new Map(before.map((p) => [name(p), p]));
  const now = new Map(after.map((p) => [name(p), p]));
  const parts: string[] = [];
  const added = after.filter((p) => !old.has(name(p)));
  const removed = before.filter((p) => !now.has(name(p)));
  const changed = after.filter((p) => old.has(name(p)) && old.get(name(p)) !== p);
  if (added.length) parts.push(`added ${added.map((p) => `\`${p}\``).join(", ")}`);
  if (removed.length) parts.push(`removed ${removed.map((p) => `\`${p}\``).join(", ")}`);
  if (changed.length) parts.push(`changed ${changed.map((p) => `\`${old.get(name(p))}\` to \`${p}\``).join(", ")}`);
  if (parts.length === 0) parts.push(`changed order from \`(${before.join(", ")})\` to \`(${after.join(", ")})\``);
  return parts.join("; ");
}

function isArrowOrFunction(lines: string[], index: number, open: number): boolean {
  const before = lines[index]!.slice(0, open);
  if (/function\s*\*?\s*[\w$]*\s*(<[^(]*>)?\s*$/.test(before)) return true;
  const rest = closingParen(lines, index, open);
  return rest !== undefined && /^\s*(:\s*[^=]+)?=>/.test(rest);
}

/** Text after the `)` matching the `(` at `open`, on the line where it closes. */
function closingParen(lines: string[], index: number, open: number): string | undefined {
  let depth = 0;
  for (let i = index; i < Math.min(lines.length, index + 50); i++) {
    const line = lines[i]!;
    for (let j = i === index ? open : 0; j < line.length; j++) {
      const c = line[j];
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) return line.slice(j + 1);
    }
  }
  return undefined;
}

/** Text between the `(` at column `open` of line `index` and its matching `)`, without comments. */
function paramsFrom(lines: string[], index: number, open: number, comment: "#" | "//"): string | undefined {
  let depth = 0;
  let text = "";
  let quote: string | undefined;
  for (let i = index; i < Math.min(lines.length, index + 50); i++) {
    const line = lines[i]!;
    for (let j = i === index ? open : 0; j < line.length; j++) {
      const c = line[j]!;
      if (quote) {
        if (c === "\\") {
          text += c + (line[j + 1] ?? "");
          j++;
          continue;
        }
        if (c === quote) quote = undefined;
      } else if (c === '"' || c === "'" || c === "`") {
        quote = c;
      } else if (line.startsWith(comment, j)) {
        break;
      } else if ("([{".includes(c)) {
        depth++;
        if (depth === 1 && c === "(") continue;
      } else if (")]}".includes(c)) {
        depth--;
        if (depth === 0) return text;
      }
      text += c;
    }
    text += " ";
  }
  return undefined;
}

/** Splits a parameter list on top-level commas. */
function splitParams(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let cur = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (quote) {
      if (c === "\\") {
        cur += c + (raw[i + 1] ?? "");
        i++;
        continue;
      }
      if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{<".includes(c)) depth++;
    else if (")]}>".includes(c) && !(c === ">" && raw[i - 1] === "=")) depth--;
    else if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** `name: int = 3` becomes `name=3`; `*args: str` becomes `*args`; `/` and `*` stay. */
function pythonParam(param: string): string {
  const [head, def] = splitTopLevel(param, "=");
  const name = splitTopLevel(head, ":")[0].trim();
  // For callers, a default of undefined is the same as an optional parameter.
  if (def?.trim() === "undefined") return name.endsWith("?") ? name : `${name}?`;
  return def === undefined ? name : `${name}=${def.trim()}`;
}

/** `name?: string = "a"` becomes `name="a"`; `opts?: T` becomes `opts?`; destructuring keeps its keys. */
function jsParam(param: string): string {
  const [head, def] = splitTopLevel(param.replace(/\/\*[\s\S]*?\*\//g, " "), "=");
  let name = head.trim();
  if (!/^[{[]/.test(name)) name = splitTopLevel(name, ":")[0].trim();
  else name = name.replace(/\}\s*:.*$/s, "}").replace(/\]\s*:.*$/s, "]");
  name = name.replace(/^(public|private|protected|readonly)\s+/, "");
  // For callers, a default of undefined is the same as an optional parameter.
  if (def?.trim() === "undefined") return name.endsWith("?") ? name : `${name}?`;
  return def === undefined ? name : `${name}=${def.trim()}`;
}

/** Splits at the first top-level `sep`; the second part is undefined when there is none. */
function splitTopLevel(s: string, sep: string): [string, string | undefined] {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if ("([{<".includes(c)) depth++;
    else if (")]}>".includes(c) && !(c === ">" && s[i - 1] === "=")) depth--;
    else if (c === sep && depth === 0 && !(sep === "=" && (s[i + 1] === "=" || s[i + 1] === ">" || "!<>".includes(s[i - 1] ?? "")))) {
      return [s.slice(0, i), s.slice(i + 1)];
    }
  }
  return [s, undefined];
}

/** `["a", "|", "b"]` as `(a) | (b)`. */
function overloads(params: string[]): string {
  return `(${params.join(", ")})`.replace(/, \|, /g, ") | (");
}

/** For arguments passed by position: compares parameters slot by slot, ignoring renames. */
function describePositional(before: string[], after: string[]): string {
  const shape = (p: string) => p.replace(/^(\.\.\.)?[A-Za-z_$][\w$]*/, "$1_");
  const parts: string[] = [];
  const changed: string[] = [];
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    if (shape(before[i]!) !== shape(after[i]!)) changed.push(`\`${before[i]}\` to \`${after[i]}\``);
  }
  if (after.length > before.length) parts.push(`added ${after.slice(before.length).map((p) => `\`${p}\``).join(", ")}`);
  if (before.length > after.length) parts.push(`removed ${before.slice(after.length).map((p) => `\`${p}\``).join(", ")}`);
  if (changed.length) parts.push(`changed ${changed.join(", ")}`);
  return parts.join("; ");
}
