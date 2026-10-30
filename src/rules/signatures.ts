// Public function signatures of Python and JavaScript/TypeScript files, reduced
// to what callers depend on: parameter names, order, optionality and defaults.
// Type annotations are left out, so adding type hints is not an interface change.
import { stringLines } from "./python.js";
import { codeSpan } from "../text.js";

export interface Signature {
  /** `name`, or `Class.name` for a method. */
  name: string;
  /** Parameters as callers see them, e.g. `["path", "strict=False"]`; overloads are joined with `|`. */
  params: string[];
  /** What callers depend on; for JavaScript, positional parameter names are left out. */
  shape: string;
  /** 1-based line of the definition. */
  line: number;
  /** For a constructor made from class fields or a type's fields: the 1-based lines of the fields, where an edit changes it. */
  span?: [number, number];
  /** Set for the fields of an exported TypeScript object type; `params` are then `name` or `name?`. */
  fields?: true;
  /** The return annotation as written, normalized; undefined when there is none or it cannot be read. */
  returns?: string;
  /** Set for an interface that extends another one. */
  extends?: true;
}

const PY_DEF = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
const PY_CLASS = /^class\s+([A-Za-z_]\w*)\b/;

/** Public top-level functions and methods of public top-level classes. */
export function pythonSignatures(text: string): Signature[] {
  const lines = text.split("\n");
  const inStrings = stringLines(text);
  const out: (Signature & { overload: boolean })[] = [];
  let cls: string | undefined;
  lines.forEach((line, i) => {
    if (inStrings.has(i + 1)) return;
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
    const decorators = decoratorsAbove(lines, i);
    // Properties are read and assigned, never called with arguments.
    if (decorators.some((d) => /^@(\w+\.(setter|getter|deleter)|(functools\.)?(cached_)?property)\b/.test(d))) return;
    const raw = paramsFrom(lines, i, line.indexOf("(", m[0].length - 1), "#");
    if (raw === undefined) return;
    let params = splitParams(raw).map(pythonParam).filter((p) => p !== "");
    // `self` and `cls` are supplied by Python, not by callers.
    if (owner && (params[0] === "self" || params[0] === "cls")) params = params.slice(1);
    const overload = decorators.some((d) => /^@(typing\.|t\.|typing_extensions\.)?overload\b/.test(d));
    const after = closingParen(lines, i, line.indexOf("(", m[0].length - 1));
    const returns = after && /^\s*->\s*(.+?)\s*:\s*(#.*)?$/.exec(after)?.[1];
    out.push({ name: owner ? `${owner}.${name}` : name, params, shape: params.join(", "), line: i + 1, overload, ...(returns && { returns: normalizeType(returns) }) });
  });
  // Without @overload, a later definition of the same name replaces the earlier one.
  const lastPlain = new Map(out.filter((s) => !s.overload).map((s) => [s.name, s]));
  const explicit = mergeOverloads(out.filter((s) => s.overload || lastPlain.get(s.name) === s).map(({ overload: _, ...s }) => s));
  const fromFields = fieldConstructors(lines, inStrings).filter((f) => !explicit.some((e) => e.name === f.name));
  return [...explicit, ...fromFields];
}

const FIELD_CLASS_DECORATOR = /^@(dataclasses\.dataclass|dataclass|attr\.s|attr\.attrs|attrs\.define|attrs\.frozen|attr\.define|attr\.frozen|define|frozen)\b/;
const KEYWORD_MODEL = /\b(BaseModel|BaseSettings)\b/;
const FIELD = /^    ([A-Za-z_]\w*)\s*:\s*(.+?)(?:\s*=\s*(.+))?$/;

/**
 * The constructor Python writes for dataclasses, attrs classes and Pydantic
 * models without their own `__init__`: one parameter per annotated field, in
 * order (by keyword only for Pydantic, so the order does not count there).
 */
function fieldConstructors(lines: string[], inStrings: Set<number>): Signature[] {
  const out: Signature[] = [];
  lines.forEach((line, i) => {
    const cls = /^class\s+([A-Za-z_]\w*)\s*(\(([^)]*)\))?\s*:/.exec(line);
    if (!cls || inStrings.has(i + 1) || cls[1]!.startsWith("_")) return;
    const decorated = decoratorsAbove(lines, i).some((d) => FIELD_CLASS_DECORATOR.test(d));
    const model = KEYWORD_MODEL.test(cls[3] ?? "");
    if (!decorated && !model) return;
    const params: string[] = [];
    let first: number | undefined;
    let last = i + 1;
    for (let j = i + 1; j < lines.length; j++) {
      const body = lines[j]!;
      if (/^\S/.test(body) && !body.startsWith("#")) break;
      if (body.trim() === "" || inStrings.has(j + 1)) continue;
      last = j + 1;
      if (/^    (async\s+)?def\s+__init__\b/.test(body)) return;
      const f = FIELD.exec(body.replace(/\s+#.*$/, ""));
      if (!f || /^(typing\.)?ClassVar\b/.test(f[2]!) || f[1] === "model_config") continue;
      first ??= j + 1;
      params.push(f[3] === undefined ? f[1]! : `${f[1]}=${f[3].trim()}`);
    }
    if (first === undefined) return;
    const shape = (model ? [...params].sort() : params).join(", ");
    out.push({ name: `${cls[1]}.__init__`, params, shape, line: i + 1, span: [first, last] });
  });
  return out;
}

/** Decorator lines directly above line `index`, trimmed. */
function decoratorsAbove(lines: string[], index: number): string[] {
  const out: string[] = [];
  for (let i = index - 1; i >= 0 && lines[i]!.trim().startsWith("@"); i--) out.push(lines[i]!.trim());
  return out;
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
      const returns = jsReturns(closingParen(lines, i, m[0].length - 1));
      out.push({ name: m[1]!, params, shape, line: i + 1, ...(returns && { returns }) });
      break;
    }
  });
  out.push(...classMethods(lines));
  return [...mergeOverloads(out), ...typeFields(lines)];
}

const JS_EXPORTED_TYPE = /^(\s*)export\s+(?:declare\s+)?(?:interface\s+([A-Za-z_$][\w$]*)\s*(?:<.*>)?\s*(extends\s+[^{]+)?\{\s*$|type\s+([A-Za-z_$][\w$]*)\s*(?:<.*>)?\s*=\s*\{\s*$)/;
const TYPE_MEMBER = /^(?:readonly\s+)?([A-Za-z_$][\w$]*|"[^"]+"|'[^']+')\s*(\?)?\s*[:(<]/;

/**
 * Fields of exported interfaces and object type aliases, as `name` or `name?`.
 * Types with index signatures, declared more than once or not closed by a
 * plain `}` are left out, because their fields are not all written here.
 */
function typeFields(lines: string[]): Signature[] {
  const out: Signature[] = [];
  const seen = new Map<string, number>();
  lines.forEach((line, i) => {
    const t = JS_EXPORTED_TYPE.exec(line);
    if (!t) return;
    const name = t[2] ?? t[4]!;
    seen.set(name, (seen.get(name) ?? 0) + 1);
    const end = lines.findIndex((l, j) => j > i && l.startsWith(`${t[1]}}`));
    if (end < 0 || !/^\s*\};?\s*$/.test(lines[end]!)) return;
    const indent = lines.slice(i + 1, end).find((l) => l.trim() !== "")?.match(/^\s*/)?.[0];
    if (!indent) return;
    const params: string[] = [];
    let first: number | undefined;
    for (let j = i + 1; j < end; j++) {
      const member = lines[j]!;
      if (!member.startsWith(indent) || /^\s/.test(member.slice(indent.length))) continue;
      const text = member.trim();
      if (/^(\/\/|\/\*|\*)/.test(text)) continue;
      // An index or call signature accepts names that are not listed.
      if (/^(\[|\(|<|new\b|get\s|set\s|\.\.\.)/.test(text)) return;
      const m = TYPE_MEMBER.exec(text);
      if (!m) return;
      first ??= j + 1;
      params.push(`${m[1]!.replace(/^["']|["']$/g, "")}${m[2] ?? ""}`);
    }
    if (first === undefined) return;
    const unique = [...new Set(params)].sort();
    out.push({ name, params: unique, shape: unique.join(", "), line: i + 1, span: [first, end], fields: true, ...(t[3] && { extends: true }) });
  });
  return out.filter((s) => seen.get(s.name) === 1);
}

/**
 * What changed in a type's fields for code that builds or reads its values:
 * fields removed, fields added as required, and optional fields made required.
 * Undefined when nothing changed for them, such as an optional field added.
 */
export function describeFields(before: string[], after: string[], inherits: boolean): string | undefined {
  const required = (fields: string[]) => new Set(fields.filter((f) => !f.endsWith("?")));
  const names = (fields: string[]) => new Set(fields.map((f) => f.replace(/\?$/, "")));
  const oldNames = names(before);
  const oldRequired = required(before);
  const nowNames = names(after);
  const parts: string[] = [];
  // A field removed from a type that extends another may have moved there.
  const removed = inherits ? [] : [...oldNames].filter((f) => !nowNames.has(f));
  const added = [...required(after)].filter((f) => !oldNames.has(f));
  const madeRequired = [...required(after)].filter((f) => oldNames.has(f) && !oldRequired.has(f));
  if (removed.length) parts.push(`removed ${removed.map((f) => codeSpan(f)).join(", ")}`);
  if (added.length) parts.push(`added required ${added.map((f) => codeSpan(f)).join(", ")}`);
  if (madeRequired.length) parts.push(`made ${madeRequired.map((f) => codeSpan(f)).join(", ")} required`);
  return parts.length ? parts.join("; ") : undefined;
}

const JS_EXPORTED_CLASS = /^(\s*)export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
const JS_METHOD = /^\s*((?:(?:public|static|async|override|readonly)\s+)*)(constructor|[A-Za-z_$][\w$]*)\s*(?:<[^(]*>)?\s*\(/;
const NOT_METHODS = new Set(["if", "for", "while", "switch", "return", "catch", "function", "get", "set", "super"]);

/** Constructors and public methods of exported classes, as `Class.constructor` and `Class.method`. */
function classMethods(lines: string[]): Signature[] {
  const out: Signature[] = [];
  lines.forEach((line, i) => {
    const cls = JS_EXPORTED_CLASS.exec(line);
    if (!cls) return;
    const end = lines.findIndex((l, j) => j > i && l.startsWith(`${cls[1]}}`));
    if (end < 0) return;
    // Members sit one level in: the indentation of the first member line.
    const indent = lines.slice(i + 1, end).find((l) => l.trim() !== "")?.match(/^\s*/)?.[0];
    if (!indent) return;
    for (let j = i + 1; j < end; j++) {
      const member = lines[j]!;
      if (!member.startsWith(indent) || /^\s/.test(member.slice(indent.length))) continue;
      const m = JS_METHOD.exec(member);
      if (!m || NOT_METHODS.has(m[2]!) || /\bstatic\b/.test(m[1]!)) continue;
      const open = m[0].length - 1;
      // A definition has a body or ends the declaration; anything else is a call.
      const rest = closingParen(lines, j, open);
      if (rest === undefined || !/^\s*(:[^=;{]+)?\s*(\{.*|;)?\s*$/.test(rest)) continue;
      const raw = paramsFrom(lines, j, open, "//");
      if (raw === undefined) continue;
      const params = splitParams(raw).map(jsParam).filter((p) => p !== "" && p !== "this");
      const shape = params.map((p) => p.replace(/^(\.\.\.)?[A-Za-z_$][\w$]*/, "$1_")).join(", ");
      const returns = jsReturns(rest);
      out.push({ name: `${cls[2]}.${m[2]}`, params, shape, line: j + 1, ...(returns && { returns }) });
    }
  });
  return out;
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
    // Overloads may return different types; which one changed is not clear.
    if (prev) delete byName.get(s.name)!.returns;
  }
  return [...byName.values()].map(({ shapes: _, ...s }) => s);
}

/**
 * The difference between two parameter lists in words: added and removed
 * parameters, changed defaults, or a changed order.
 */
export function describeChange(before: string[], after: string[], positional = false): string {
  if (before.includes("|") || after.includes("|")) return `went from ${codeSpan(overloads(before))} to ${codeSpan(overloads(after))}`;
  if (positional) return describePositional(before, after);
  const name = (p: string) => p.split("=")[0]!.replace(/\?$/, "");
  const old = new Map(before.map((p) => [name(p), p]));
  const now = new Map(after.map((p) => [name(p), p]));
  const parts: string[] = [];
  const added = after.filter((p) => !old.has(name(p)));
  const removed = before.filter((p) => !now.has(name(p)));
  const changed = after.filter((p) => old.has(name(p)) && old.get(name(p)) !== p);
  if (added.length) parts.push(`added ${added.map((p) => codeSpan(p)).join(", ")}`);
  if (removed.length) parts.push(`removed ${removed.map((p) => codeSpan(p)).join(", ")}`);
  if (changed.length) parts.push(`changed ${changed.map((p) => `${codeSpan(old.get(name(p))!)} to ${codeSpan(p)}`).join(", ")}`);
  if (parts.length === 0) parts.push(`changed order from \`(${before.join(", ")})\` to \`(${after.join(", ")})\``);
  return parts.join("; ");
}

/** The return annotation after a parameter list's `)` on the same line: `): T {`, `): T;` or `): T =>`. */
function jsReturns(after: string | undefined): string | undefined {
  const m = after === undefined ? null : /^\s*:\s*(.+?)\s*(=>.*|\{.*|;)?\s*$/.exec(after);
  // A type that goes on to the next line, or a type predicate, is not read.
  if (!m || /[{(<[|&,]$|^asserts\b|\bis\s/.test(m[1]!)) return undefined;
  return normalizeType(m[1]!);
}

/**
 * A type annotation in a form that spelling changes leave alone: whitespace,
 * quotes of forward references, `typing.` prefixes, `List` for `list`,
 * `Optional[X]` for `X | None`, and the order of union members.
 */
export function normalizeType(type: string): string {
  let t = type.replace(/\s+/g, " ").trim().replace(/^["']([^"']*)["']$/, "$1").replace(/\btyping(_extensions)?\./g, "");
  t = t.replace(/\b(List|Dict|Set|FrozenSet|Tuple|Type)\[/g, (_, g: string) => `${g.toLowerCase()}[`);
  for (let prev = ""; prev !== t; ) {
    prev = t;
    t = t.replace(/\bOptional\[([^[\]]*(?:\[[^[\]]*\])?[^[\]]*)\]/g, "$1 | None");
  }
  const members = splitTopLevelAll(t, "|");
  return members.length > 1 ? members.sort().join(" | ") : t;
}

function splitTopLevelAll(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if ("([{<".includes(c)) depth++;
    else if (")]}>".includes(c)) depth--;
    if (c === sep && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  parts.push(cur.trim());
  return parts;
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
    if (shape(before[i]!) !== shape(after[i]!)) changed.push(`${codeSpan(before[i]!)} to ${codeSpan(after[i]!)}`);
  }
  if (after.length > before.length) parts.push(`added ${after.slice(before.length).map((p) => codeSpan(p)).join(", ")}`);
  if (before.length > after.length) parts.push(`removed ${before.slice(after.length).map((p) => codeSpan(p)).join(", ")}`);
  if (changed.length) parts.push(`changed ${changed.join(", ")}`);
  return parts.join("; ");
}
