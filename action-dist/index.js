// src/action.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { appendFileSync, readFileSync as readFileSync3, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";

// src/index.ts
import { readFileSync } from "node:fs";

// node_modules/smol-toml/dist/error.js
function getLineColFromPtr(string, ptr) {
  let lines = string.slice(0, ptr).split(/\r?\n/);
  return [lines.length, lines.pop().length + 1];
}
function makeCodeBlock(string, line, column) {
  let lines = string.split(/\r?\n/);
  let codeblock = "";
  let numberLen = (Math.log10(line + 1) | 0) + 1;
  for (let i = line - 1; i <= line + 1; i++) {
    let l = lines[i - 1];
    if (!l)
      continue;
    codeblock += i.toString().padEnd(numberLen, " ");
    codeblock += ":  ";
    codeblock += l;
    codeblock += "\n";
    if (i === line) {
      codeblock += " ".repeat(numberLen + column + 2);
      codeblock += "^\n";
    }
  }
  return codeblock;
}
var TomlError = class _TomlError extends Error {
  line;
  column;
  codeblock;
  constructor(message, options) {
    const [line, column] = getLineColFromPtr(options.toml, options.ptr);
    const codeblock = makeCodeBlock(options.toml, line, column);
    super(`Invalid TOML document: ${message}

${codeblock}`, options);
    this.line = line;
    this.column = column;
    this.codeblock = codeblock;
  }
  /** @internal */
  static x(message, ctx, ptr) {
    throw new _TomlError(message, { toml: ctx.s, ptr: ptr ?? ctx.p });
  }
};

// node_modules/smol-toml/dist/primitive.js
function parseString(ctx) {
  let startPtr = ctx.p;
  let c = ctx.s.charCodeAt(ctx.p++);
  let first = c;
  let isLiteral = c === 39;
  let isMultiline = c === ctx.s.charCodeAt(ctx.p) && c === ctx.s.charCodeAt(ctx.p + 1);
  if (isMultiline) {
    if ((c = ctx.s.charCodeAt(ctx.p += 2)) === 10)
      ctx.p++;
    else if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)
      ctx.p += 2;
  }
  let parsed = "";
  let sliceStart = ctx.p;
  let state = 0;
  for (; ctx.p < ctx.s.length; ctx.p++) {
    c = ctx.s.charCodeAt(ctx.p);
    if (isMultiline && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)) {
      state = state && 3;
    } else if (c < 32 && c !== 9 || c === 127) {
      TomlError.x("control characters are not allowed in strings", ctx);
    } else if ((!state || state === 3) && c === first && (!isMultiline || ctx.s.charCodeAt(ctx.p + 1) === first && ctx.s.charCodeAt(ctx.p + 2) === first)) {
      if (isMultiline) {
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
      }
      if (!state) {
        let s = ctx.s.slice(sliceStart, ctx.p);
        parsed = parsed ? parsed + s : s;
      }
      ctx.p += isMultiline ? 3 : 1;
      return parsed;
    } else if (!state) {
      if (!isLiteral && c === 92) {
        parsed += ctx.s.slice(sliceStart, sliceStart = ctx.p);
        state = 1;
      }
    } else if (state === 1) {
      if (c === 120 || c === 117 || c === 85) {
        let errPtr = ctx.p++ - 1;
        let value = 0;
        let len = c === 120 ? 2 : c === 117 ? 4 : 8;
        for (let j = 0; j < len; j++, ctx.p++) {
          let hex = ctx.s.charCodeAt(ctx.p);
          let digit = (
            /* 0-9 */
            hex >= 48 && hex <= 57 ? hex - 48 : (
              /* A-F */
              hex >= 65 && hex <= 70 ? hex - 65 + 10 : (
                /* a-f */
                hex >= 97 && hex <= 102 ? hex - 97 + 10 : -1
              )
            )
          );
          if (digit < 0)
            TomlError.x("invalid non-hex character in unicode escape", ctx);
          value = value << 4 | digit;
        }
        if (value < 0 || value > 1114111 || value >= 55296 && value <= 57343) {
          TomlError.x("invalid unicode escape", ctx, errPtr);
        }
        parsed += String.fromCodePoint(value);
        sliceStart = ctx.p--;
        state = 0;
      } else if (isMultiline && (c === 32 || c === 9)) {
        state = 2;
      } else {
        if (c === 98)
          parsed += "\b";
        else if (c === 116)
          parsed += "	";
        else if (c === 110)
          parsed += "\n";
        else if (c === 102)
          parsed += "\f";
        else if (c === 114)
          parsed += "\r";
        else if (c === 101)
          parsed += "\x1B";
        else if (c === 34)
          parsed += '"';
        else if (c === 92)
          parsed += "\\";
        else
          TomlError.x("unrecognised escape sequence", ctx);
        sliceStart = ctx.p + 1;
        state = 0;
      }
    } else if (c !== 32 && c !== 9) {
      if (state === 2)
        TomlError.x("invalid escape: only line-ending whitespace may be escaped", ctx, sliceStart);
      state = !isLiteral && c === 92 ? 1 : 0;
      sliceStart = ctx.p;
    }
  }
  TomlError.x("unfinished string", ctx, startPtr);
}

// node_modules/smol-toml/dist/date.js
var DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[Tt ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|z|[-+]\d{2}:\d{2})?$/i;
var TomlDate = class _TomlDate extends Date {
  #hasDate = false;
  #hasTime = false;
  #offset = null;
  constructor(date, fasttype, unsafeDelim) {
    let hasDate = true;
    let hasTime = true;
    let offset = "Z";
    let c;
    if (typeof date === "string") {
      if (fasttype)
        prep: {
          if (fasttype < 3) {
            if (+date.slice(11, 13) > 23) {
              date = "";
              break prep;
            }
            if (fasttype === 2) {
              offset = null;
              date += "Z";
            } else if ((c = date.charCodeAt(date.length - 1)) !== 90 && c !== 122) {
              offset = date.slice(date.length - 6);
            }
            if (unsafeDelim)
              date = date.slice(0, 10) + "T" + date.slice(11);
          } else if (fasttype === 4) {
            date = +date.slice(0, 2) > 23 ? "" : `0000-01-01T${date}Z`;
          }
          hasDate = fasttype !== 4;
          hasTime = fasttype !== 3;
        }
      else {
        let match = date.match(DATE_TIME_RE);
        if (match) {
          if (!match[1]) {
            hasDate = false;
            date = `0000-01-01T${date}`;
          }
          hasTime = !!match[2];
          hasTime && date[10] === " " && (date = date.replace(" ", "T"));
          if (match[2] && +match[2] > 23) {
            date = "";
          } else {
            offset = match[3] || null;
            if (!offset && hasTime)
              date += "Z";
          }
        } else {
          date = "";
        }
      }
    }
    super(date);
    if (!isNaN(this.getTime())) {
      this.#hasDate = hasDate;
      this.#hasTime = hasTime;
      this.#offset = offset;
    }
  }
  isDateTime() {
    return this.#hasDate && this.#hasTime;
  }
  isLocal() {
    return !this.#hasDate || !this.#hasTime || !this.#offset;
  }
  isDate() {
    return this.#hasDate && !this.#hasTime;
  }
  isTime() {
    return this.#hasTime && !this.#hasDate;
  }
  isValid() {
    return this.#hasDate || this.#hasTime;
  }
  toISOString() {
    let iso = super.toISOString();
    if (this.isDate())
      return iso.slice(0, 10);
    if (this.isTime())
      return iso.slice(11, 23);
    if (this.#offset === null)
      return iso.slice(0, -1);
    if (this.#offset === "Z" || this.#offset === "z")
      return iso;
    let offset = +this.#offset.slice(1, 3) * 60 + +this.#offset.slice(4, 6);
    offset = this.#offset[0] === "-" ? offset : -offset;
    let offsetDate = new Date(this.getTime() - offset * 6e4);
    return offsetDate.toISOString().slice(0, -1) + this.#offset;
  }
  static wrapAsOffsetDateTime(jsDate, offset = "Z") {
    let date = new _TomlDate(jsDate);
    date.#offset = offset;
    return date;
  }
  static wrapAsLocalDateTime(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#offset = null;
    return date;
  }
  static wrapAsLocalDate(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#hasTime = false;
    date.#offset = null;
    return date;
  }
  static wrapAsLocalTime(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#hasDate = false;
    date.#offset = null;
    return date;
  }
};

// node_modules/smol-toml/dist/extract.js
function isDigit(char, base = 10) {
  return base === 16 ? char > 47 && char < 58 || char > 64 && char < 71 || char > 96 && char < 103 : char > 47 && char < 48 + base;
}
function isEndOfValue(char, delim) {
  return char === 32 || char === 9 || char === 10 || char === 13 || // Structure end or next value delimiter
  delim && (char === delim || char === 44) || // Comment
  char === 35;
}
function extractValue(ctx, end) {
  let errPtr = ctx.p;
  let c = ctx.s.charCodeAt(ctx.p);
  if (c === 91 || c === 123) {
    ctx.d-- || TomlError.x("document contains excessively nested structures. aborting.", ctx);
    let value = c === 91 ? parseArray(ctx) : parseInlineTable(ctx);
    ctx.d++;
    return value;
  }
  if (c === 34 || c === 39) {
    return parseString(ctx);
  }
  if (c === 116) {
    if (ctx.s.charCodeAt(++ctx.p) !== 114 || ctx.s.charCodeAt(++ctx.p) !== 117 || ctx.s.charCodeAt(++ctx.p) !== 101)
      TomlError.x("invalid value", ctx, errPtr);
    return ctx.p++, true;
  }
  if (c === 102) {
    if (ctx.s.charCodeAt(++ctx.p) !== 97 || ctx.s.charCodeAt(++ctx.p) !== 108 || ctx.s.charCodeAt(++ctx.p) !== 115 || ctx.s.charCodeAt(++ctx.p) !== 101)
      TomlError.x("invalid value", ctx, errPtr);
    return ctx.p++, false;
  }
  if (c === 43 || c === 45) {
    return parseNumber(ctx, ctx.p, ctx.s.charCodeAt(++ctx.p), 44 - c, end);
  }
  if (ctx.s.charCodeAt(ctx.p + 4) === 45 && ctx.s.charCodeAt(ctx.p + 7) === 45) {
    return parseDate(ctx, c, end);
  }
  if (ctx.s.charCodeAt(ctx.p + 2) === 58) {
    return parseTime(ctx, c, end);
  }
  return parseNumber(ctx, ctx.p, c, 0, end);
}
function parseNumber(ctx, startPtr, startChr, sign, endChr) {
  let c = startChr;
  let state = 0;
  let hasUnderscores = false;
  if (c === 105) {
    if (ctx.s.charCodeAt(++ctx.p) !== 110 || ctx.s.charCodeAt(++ctx.p) !== 102)
      TomlError.x("invalid value", ctx, startPtr);
    return ctx.p++, (sign || 1) / 0;
  }
  if (c === 110) {
    if (ctx.s.charCodeAt(++ctx.p) !== 97 || ctx.s.charCodeAt(++ctx.p) !== 110)
      TomlError.x("invalid value", ctx, startPtr);
    return ctx.p++, NaN;
  }
  if (c === 48) {
    if (++ctx.p >= ctx.s.length || isEndOfValue(c = ctx.s.charCodeAt(ctx.p), endChr))
      return ctx.bi === true ? 0n : 0;
    if (!sign) {
      if (c === 120)
        return parseIntegerBaseN(ctx, startPtr, 16, endChr);
      else if (c === 98)
        return parseIntegerBaseN(ctx, startPtr, 2, endChr);
      else if (c === 111)
        return parseIntegerBaseN(ctx, startPtr, 8, endChr);
    }
    if (c === 46)
      state = 2;
    else if (c === 101 || c === 69)
      state = 4;
    else
      TomlError.x("illegal leading zero", ctx, startPtr);
  } else if (!isDigit(c))
    TomlError.x("invalid value", ctx, startPtr);
  while (++ctx.p < ctx.s.length && (c = ctx.s.charCodeAt(ctx.p), !isEndOfValue(c, endChr))) {
    if (!state)
      state = 1;
    if (c === 95) {
      if (!(state & 1))
        TomlError.x("illegal underscore", ctx);
      state += 11;
      hasUnderscores = true;
    } else if (state === 1 && c === 46)
      state = 2;
    else if ((state === 1 || state === 3) && (c === 101 || c === 69))
      state = 4;
    else if (state === 4 && (c === 43 || c === 45)) {
      state = 6;
    } else if (!isDigit(c))
      TomlError.x(`illegal character in numeric literal`, ctx);
    else if (state > 9)
      state -= 11;
    else if (!(state & 1))
      state++;
  }
  if (!state) {
    let val = (startChr - 48) * (sign || 1);
    return ctx.bi === true ? BigInt(val) : val;
  }
  if (!(state & 1))
    TomlError.x("unfinished numeric value", ctx, startPtr);
  let str = ctx.s.slice(startPtr, ctx.p);
  if (hasUnderscores)
    str = str.replaceAll("_", "");
  return state > 1 ? parseFloat(str) : parseInteger(ctx, str, 10, startPtr);
}
function parseIntegerBaseN(ctx, startPtr, base, endChr) {
  let c, underscore = 1;
  while (++ctx.p < ctx.s.length && (c = ctx.s.charCodeAt(ctx.p), !isEndOfValue(c, endChr))) {
    if (c === 95) {
      if (underscore & 1)
        TomlError.x("illegal underscore", ctx);
      underscore = 3;
    } else if (!isDigit(c, base))
      TomlError.x(`illegal character in numeric literal`, ctx);
    else if (underscore & 1)
      underscore--;
  }
  if (underscore & 1)
    TomlError.x("unfinished numeric value", ctx);
  let str = ctx.s.slice(startPtr + 2, ctx.p);
  if (underscore)
    str = str.replaceAll("_", "");
  return parseInteger(ctx, str, base, startPtr);
}
function parseInteger(ctx, str, base, startPtr) {
  if (ctx.bi !== true)
    int: {
      let val = parseInt(str, base);
      if (!Number.isSafeInteger(val)) {
        if (ctx.bi)
          break int;
        TomlError.x("integer value cannot be represented losslessly", ctx, startPtr);
      }
      return val;
    }
  return base === 10 ? BigInt(str) : BigInt((base === 2 ? "0b" : base === 8 ? "0o" : "0x") + str);
}
function parseDate(ctx, c, endChr) {
  let startPtr = ctx.p++, unsafeSeparator;
  if (!isDigit(c) || !isDigit(ctx.s.charCodeAt(ctx.p++)) || !isDigit(ctx.s.charCodeAt(ctx.p++)) || !isDigit(ctx.s.charCodeAt(ctx.p++))) {
    return parseNumber(ctx, ctx.p = startPtr, c, 0, endChr);
  }
  ctx.p += 5;
  if (!isDigit(ctx.s.charCodeAt(ctx.p++)))
    TomlError.x("invalid date-time: date part is malformed", ctx, startPtr);
  if (ctx.p >= ctx.s.length || ((c = ctx.s.charCodeAt(ctx.p)) !== 32 || (unsafeSeparator = true, !isDigit(ctx.s.charCodeAt(ctx.p + 1)))) && c !== 84 && c !== 116) {
    let t2 = ctx.s.slice(startPtr, ctx.p);
    return readDate(ctx, t2, 3, false, startPtr);
  }
  if (ctx.s.charCodeAt(ctx.p += 3) !== 58)
    TomlError.x("invalid date-time: time part is malformed", ctx, startPtr);
  if (ctx.s.charCodeAt(ctx.p += 3) === 58)
    ctx.p += 3;
  if (ctx.s.charCodeAt(ctx.p) === 46)
    while (isDigit(ctx.s.charCodeAt(++ctx.p)))
      ;
  if (c = ctx.s.charCodeAt(ctx.p)) {
    if (c === 90 || c === 122) {
      let t2 = ctx.s.slice(startPtr, ++ctx.p);
      return readDate(ctx, t2, 1, unsafeSeparator, startPtr, "[+00:00]");
    }
    if (c === 43 || c === 45) {
      let t2 = ctx.s.slice(startPtr, ctx.p += 6);
      return readDate(ctx, t2, 1, unsafeSeparator, startPtr, !ctx.ld && "[" + ctx.s.slice(ctx.p - 6, ctx.p) + "]");
    }
  }
  let t = ctx.s.slice(startPtr, ctx.p);
  return readDate(ctx, t, 2, unsafeSeparator, startPtr);
}
function parseTime(ctx, c, endChr) {
  let start = ctx.p;
  if (!isDigit(c) || !isDigit(ctx.s.charCodeAt(++ctx.p))) {
    return parseNumber(ctx, --ctx.p, c, 0, endChr);
  }
  if (ctx.s.charCodeAt(ctx.p += 4) === 58)
    ctx.p += 3;
  if (ctx.s.charCodeAt(ctx.p) === 46)
    while (isDigit(ctx.s.charCodeAt(++ctx.p)))
      ;
  let t = ctx.s.slice(start, ctx.p);
  return readDate(ctx, t, 4, false, start);
}
function readDate(ctx, str, type, unsafeDelim, errPtr, temporalSuffix) {
  if (ctx.ld) {
    let date = new TomlDate(str, type, unsafeDelim);
    if (!date.isValid())
      TomlError.x("invalid date", ctx, errPtr);
    return date;
  }
  try {
    if (temporalSuffix)
      str += temporalSuffix;
    switch (type) {
      case 1:
        return Temporal.ZonedDateTime.from(str);
      case 2:
        return Temporal.PlainDateTime.from(str);
      case 3:
        return Temporal.PlainDate.from(str);
      case 4:
        return Temporal.PlainTime.from(str);
    }
  } catch (e) {
    TomlError.x(e instanceof Error ? e.message : "" + e, ctx, errPtr);
  }
}

// node_modules/smol-toml/dist/util.js
function skipComment(ctx) {
  for (; ctx.p < ctx.s.length; ctx.p++) {
    let c = ctx.s.charCodeAt(ctx.p);
    if (c === 10)
      break;
    if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10) {
      ctx.p++;
      break;
    }
    if (c < 32 && c !== 9 || c === 127) {
      TomlError.x("control characters are not allowed in comments", ctx);
    }
  }
}
function skipVoid(ctx, banNewLines, banComments) {
  let c;
  while (ctx.p < ctx.s.length) {
    while (ctx.p < ctx.s.length && ((c = ctx.s.charCodeAt(ctx.p)) === 32 || c === 9 || !banNewLines && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)))
      ctx.p++;
    if (banComments || c !== 35)
      break;
    skipComment(ctx);
  }
}

// node_modules/smol-toml/dist/struct.js
function parseKey(ctx, end = 61) {
  let startPtr;
  let state = 0;
  let parsed = [];
  let sliceStart;
  let c = ctx.s.charCodeAt(startPtr = ctx.p);
  do {
    if (c === end) {
      if (!state)
        TomlError.x("unexpected end of key", ctx);
      if (state === 1)
        parsed.push(ctx.s.slice(sliceStart, ctx.p));
      return ctx.p++, parsed;
    } else if (c === 46) {
      if (!state)
        TomlError.x("illegal empty bare key", ctx);
      if (state === 1)
        parsed.push(ctx.s.slice(sliceStart, ctx.p));
      state = 0;
    } else if (!state && (c === 34 || c === 39)) {
      if (c === ctx.s.charCodeAt(ctx.p + 1) && c === ctx.s.charCodeAt(ctx.p + 2))
        TomlError.x("illegal quoted key: multiline strings are not allowed", ctx);
      parsed.push(parseString(ctx));
      state = 2;
      ctx.p--;
    } else if (c === 32 || c === 9) {
      if (state === 1) {
        parsed.push(ctx.s.slice(sliceStart, ctx.p));
        state = 2;
      }
    } else if (state === 2 || c < 48 && c !== 45 || c > 57 && c < 65 || c > 90 && c < 97 && c !== 95 || c > 122) {
      TomlError.x("illegal character in key", ctx);
    } else if (!state) {
      state = 1;
      sliceStart = ctx.p;
    }
  } while (c = ctx.s.charCodeAt(++ctx.p));
  TomlError.x("incomplete key-value: cannot find end of key", ctx, startPtr);
}
function parseInlineTable(ctx) {
  let startPtr = ctx.p++;
  let res = /* @__PURE__ */ Object.create(null);
  let seen = /* @__PURE__ */ new Set();
  let c;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 125) {
      ctx.p++;
      return res;
    }
    let k;
    let t = res;
    let hasOwn = false;
    let errPtr = ctx.p;
    let key = parseKey(ctx);
    for (let i = 0; i < key.length; i++) {
      if (i)
        t = hasOwn ? t[k] : t[k] = /* @__PURE__ */ Object.create(null);
      k = key[i];
      if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen.has(t[k]))) {
        TomlError.x("trying to redefine an already defined value", ctx, errPtr);
      }
      let unsafe = k === "__proto__";
      if (ctx.uk && (unsafe || k === "constructor")) {
        t = ctx.uk !== 1 && TomlError.x("document contains an unsafe property", ctx, errPtr);
        break;
      }
      if (!hasOwn && unsafe) {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
      }
    }
    if (hasOwn) {
      TomlError.x("trying to redefine an already defined value", ctx, errPtr);
    }
    skipVoid(ctx, true, true);
    let value = extractValue(
      ctx,
      125
      /* } */
    );
    if (t && typeof (t[k] = value) === "object")
      seen.add(value);
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 125) {
      return res;
    }
    if (c !== 44)
      TomlError.x("expected comma or end of structure", ctx, ctx.p - 1);
  }
  TomlError.x("unfinished table", ctx, startPtr);
}
function parseArray(ctx) {
  let startPtr = ctx.p++;
  let res = [];
  let c;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 93) {
      ctx.p++;
      return res;
    }
    res.push(extractValue(
      ctx,
      93
      /* ] */
    ));
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 93) {
      return res;
    }
    if (c !== 44)
      TomlError.x("expected comma or end of structure", ctx, ctx.p - 1);
  }
  TomlError.x("unfinished array", ctx, startPtr);
}

// node_modules/smol-toml/dist/parse.js
function peekTable(ctx, key, table, meta, type) {
  let t = table;
  let m = meta;
  let k;
  let hasOwn = false;
  let state;
  for (let i = 0; i < key.length; i++) {
    if (i) {
      t = hasOwn ? t[k] : t[k] = /* @__PURE__ */ Object.create(null);
      m = (state = m[k]).c;
      if (type === 0 && (state.t === 1 || state.t === 2)) {
        return null;
      }
      if (state.t === 2) {
        let l = t.length - 1;
        t = t[l];
        m = m[l].c;
      }
    }
    k = key[i];
    if ((hasOwn = Object.hasOwn(t, k)) && m[k]?.t === 0 && m[k]?.d) {
      return null;
    }
    if (!hasOwn) {
      let unsafe = k === "__proto__";
      if (ctx.uk && (unsafe || k === "constructor"))
        return false;
      if (unsafe) {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        Object.defineProperty(m, k, { enumerable: true, configurable: true, writable: true });
      }
      m[k] = {
        t: i < key.length - 1 && type === 2 ? 3 : type,
        d: false,
        i: 0,
        c: /* @__PURE__ */ Object.create(null)
      };
    }
  }
  state = m[k];
  if (state.t !== type && !(type === 1 && state.t === 3)) {
    return null;
  }
  if (type === 2) {
    if (!state.d) {
      state.d = true;
      t[k] = [];
    }
    t[k].push(t = /* @__PURE__ */ Object.create(null));
    state.c[state.i++] = state = { t: 1, d: false, i: 0, c: /* @__PURE__ */ Object.create(null) };
  }
  if (state.d) {
    return null;
  }
  state.d = true;
  if (type === 1) {
    t = hasOwn ? t[k] : t[k] = /* @__PURE__ */ Object.create(null);
  } else if (type === 0 && hasOwn) {
    return null;
  }
  return [k, t, state.c];
}
function validateTablePeek(ctx, peek, ptr) {
  if (peek === null || ctx.uk === 2)
    TomlError.x(peek === null ? "trying to redefine an already defined table or value" : "document contains an unsafe property", ctx, ptr);
}
function parse(toml2, options = {}) {
  let ctx = {
    s: toml2,
    p: 0,
    d: options.maxDepth ?? 1e3,
    bi: options.integersAsBigInt ?? false,
    ld: options.useLegacyDate ?? true,
    uk: options.unsafeKeyBehaviour === "throw" ? 2 : options.unsafeKeyBehaviour === "drop" ? 1 : 0
  };
  let res = /* @__PURE__ */ Object.create(null);
  let meta = /* @__PURE__ */ Object.create(null);
  let tmp;
  let skipping = false;
  let tbl = res;
  let m = meta;
  if (toml2.charCodeAt(0) === 65279)
    ctx.p++;
  skipVoid(ctx);
  while (ctx.p < toml2.length) {
    if (toml2.charCodeAt(ctx.p) === 91) {
      let isTableArray = toml2.charCodeAt(++ctx.p) === 91;
      tmp = ctx.p += +isTableArray;
      skipping = false;
      let k = parseKey(
        ctx,
        93
        /* ] */
      );
      if (isTableArray) {
        if (toml2.charCodeAt(ctx.p) !== 93) {
          TomlError.x("expected end of table array declaration", ctx);
        }
        ctx.p++;
      }
      let p = peekTable(
        ctx,
        k,
        res,
        meta,
        isTableArray ? 2 : 1
        /* Type.EXPLICIT */
      );
      if (!p) {
        validateTablePeek(ctx, p, tmp);
        skipping = true;
      } else {
        m = p[2];
        tbl = p[1];
      }
    } else {
      tmp = ctx.p;
      let k = parseKey(ctx);
      let p = peekTable(
        ctx,
        k,
        tbl,
        m,
        0
        /* Type.DOTTED */
      );
      if (!p && !skipping)
        validateTablePeek(ctx, p, tmp);
      skipVoid(ctx, true, true);
      let v = extractValue(ctx, void 0);
      if (p && !skipping)
        p[1][p[0]] = v;
    }
    skipVoid(ctx, true);
    if (ctx.p < toml2.length && (tmp = toml2.charCodeAt(ctx.p)) !== 10 && (tmp !== 13 || toml2.charCodeAt(ctx.p + 1) !== 10)) {
      TomlError.x("each key-value declaration must be followed by an end-of-line", ctx);
    }
    skipVoid(ctx);
  }
  return res;
}

// node_modules/smol-toml/dist/stringify.js
var HAS_WELLFORMED = !!"".isWellFormed;

// src/config.ts
var CONFIG_FILE = ".rsp.toml";
var ConfigError = class extends Error {
};
function parseConfig(text, rules, path = CONFIG_FILE) {
  let doc;
  try {
    doc = parse(text);
  } catch (err) {
    throw new ConfigError(`${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const fail = (msg) => {
    throw new ConfigError(`${path}: ${msg}`);
  };
  checkKeys(doc, ["exclude", "rules"], "", fail);
  const config = { path, exclude: strings(doc.exclude, "exclude", fail), rules: {} };
  const ruleTables = doc.rules ?? {};
  if (!isTable(ruleTables)) fail("`rules` must be a table");
  for (const [id, value] of Object.entries(ruleTables)) {
    const rule = rules.find((r) => r.id === id);
    if (!rule) fail(`unknown rule "${id}"; known rules: ${rules.map((r) => r.id).join(", ")}`);
    if (!isTable(value)) fail(`rules."${id}" must be a table`);
    const table = value;
    checkKeys(table, ["enabled", "exclude", "allow"], `rules."${id}".`, fail);
    if (table.enabled !== void 0 && typeof table.enabled !== "boolean") fail(`rules."${id}".enabled must be true or false`);
    const allow = strings(table.allow, `rules."${id}".allow`, fail);
    const unknown = rule.knownKeys ? allow.filter((k) => !rule.knownKeys.includes(k)) : [];
    if (unknown.length > 0) {
      fail(`rules."${id}".allow: unknown ${unknown.map((k) => `"${k}"`).join(", ")}; known: ${rule.knownKeys.join(", ")}`);
    }
    config.rules[id] = {
      enabled: table.enabled ?? true,
      exclude: strings(table.exclude, `rules."${id}".exclude`, fail),
      allow
    };
  }
  return config;
}
function checkKeys(table, known, prefix, fail) {
  for (const key of Object.keys(table)) {
    if (!known.includes(key)) fail(`unknown key "${prefix}${key}"; expected one of ${known.map((k) => prefix + k).join(", ")}`);
  }
}
function strings(value, name, fail) {
  if (value === void 0) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) fail(`${name} must be a list of strings`);
  return [...new Set(value)].sort();
}
function isTable(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

// src/diff.ts
var HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
function parseUnifiedDiff(text) {
  const files = [];
  let current;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const [oldPath, newPath] = splitGitHeader(raw.slice("diff --git ".length));
      current = { path: newPath, oldPath, status: "modified", binary: false, lines: [] };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (!current) continue;
    if (inHunk) {
      if (raw.startsWith("+")) {
        current.lines.push({ kind: "add", text: raw.slice(1), newLine: newLine++ });
        continue;
      }
      if (raw.startsWith("-")) {
        current.lines.push({ kind: "del", text: raw.slice(1), oldLine: oldLine++ });
        continue;
      }
      if (raw.startsWith(" ")) {
        oldLine++;
        newLine++;
        continue;
      }
      if (raw.startsWith("\\")) continue;
      inHunk = false;
    }
    const hunk = HUNK_HEADER.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
    } else if (raw.startsWith("new file mode")) {
      current.status = "added";
    } else if (raw.startsWith("deleted file mode")) {
      current.status = "deleted";
    } else if (raw.startsWith("rename from ")) {
      current.status = "renamed";
      current.oldPath = unquote(raw.slice("rename from ".length));
    } else if (raw.startsWith("rename to ")) {
      current.status = "renamed";
      current.path = unquote(raw.slice("rename to ".length));
    } else if (raw.startsWith("Binary files ")) {
      current.binary = true;
    } else if (raw.startsWith("--- ")) {
      const p = raw.slice(4);
      if (p !== "/dev/null") current.oldPath = stripPrefix(unquote(p), "a/");
    } else if (raw.startsWith("+++ ")) {
      const p = raw.slice(4);
      if (p !== "/dev/null") current.path = stripPrefix(unquote(p), "b/");
    }
  }
  for (const f of files) {
    if (f.status === "deleted") f.path = f.oldPath;
  }
  return files;
}
function splitGitHeader(rest) {
  if (rest.startsWith('"')) {
    const end = closingQuote(rest);
    const oldPath = unquote(rest.slice(0, end + 1));
    const newPath = unquote(rest.slice(end + 2));
    return [stripPrefix(oldPath, "a/"), stripPrefix(newPath, "b/")];
  }
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest[half] === " ") {
    const oldPath = rest.slice(0, half);
    const newPath = rest.slice(half + 1);
    if (oldPath.slice(2) === newPath.slice(2)) {
      return [stripPrefix(oldPath, "a/"), stripPrefix(newPath, "b/")];
    }
  }
  const idx = rest.indexOf(" b/");
  return [stripPrefix(rest.slice(0, idx), "a/"), stripPrefix(rest.slice(idx + 1), "b/")];
}
function closingQuote(s) {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === '"') return i;
  }
  return s.length - 1;
}
var ESCAPES = { n: "\n", t: "	", '"': '"', "\\": "\\" };
function unquote(p) {
  if (!p.startsWith('"') || !p.endsWith('"')) return p;
  const body = p.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "\\") {
      bytes.push(...Buffer.from(c, "utf8"));
      continue;
    }
    const next = body[++i];
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i, i + 3), 8));
      i += 2;
    } else {
      bytes.push(...Buffer.from(ESCAPES[next] ?? next, "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}
function stripPrefix(p, prefix) {
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

// src/git.ts
import { execFileSync } from "node:child_process";
var STABLE_CONFIG = [
  "-c",
  "core.quotePath=false",
  "-c",
  "diff.noprefix=false",
  "-c",
  "diff.mnemonicPrefix=false",
  "-c",
  "diff.renames=true"
];
function git(repoDir, args) {
  return execFileSync("git", [...STABLE_CONFIG, ...args], {
    cwd: repoDir,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
}
function resolveCommit(repoDir, ref) {
  return git(repoDir, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).trim();
}
function mergeBase(repoDir, a, b) {
  return git(repoDir, ["merge-base", a, b]).trim();
}
function diff(repoDir, base, head) {
  return git(repoDir, [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--find-renames",
    "--unified=0",
    base,
    head
  ]);
}
function readAt(repoDir, commit, path) {
  try {
    return git(repoDir, ["show", `${commit}:${path}`]);
  } catch {
    return void 0;
  }
}
function listFiles(repoDir, commit) {
  return git(repoDir, ["ls-tree", "-r", "-z", "--name-only", commit]).split("\0").filter((p) => p.length > 0).sort();
}

// src/glob.ts
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

// src/context.ts
function buildContext(repoDir, baseRef, headRef, exclude = []) {
  const head = resolveCommit(repoDir, headRef);
  const base = mergeBase(repoDir, resolveCommit(repoDir, baseRef), head);
  const excluded = exclude.map(globToRegExp);
  const files = parseUnifiedDiff(diff(repoDir, base, head)).filter(
    (f) => !excluded.some((re) => re.test(f.path) || re.test(f.oldPath))
  );
  const cache = /* @__PURE__ */ new Map();
  const read = (commit, path) => {
    const key = `${commit}:${path}`;
    if (!cache.has(key)) cache.set(key, readAt(repoDir, commit, path));
    return cache.get(key);
  };
  let headFiles;
  return {
    repoDir,
    base,
    head,
    files,
    readBase: (path) => read(base, path),
    readHead: (path) => read(head, path),
    listHead: () => headFiles ??= listFiles(repoDir, head)
  };
}

// src/engine.ts
import { createHash } from "node:crypto";

// src/version.ts
var VERSION = "0.4.0";

// src/engine.ts
function runRules(ctx, rules, options = [], config) {
  const opts = options.map((o) => ` ${o}`).join("");
  const findings = [];
  for (const rule of rules) {
    const rc = config?.rules[rule.id];
    const excluded = (rc?.exclude ?? []).map(globToRegExp);
    for (const raw of rule.run(ctx)) {
      if (rc?.allow.includes(raw.key)) continue;
      if (raw.locations.some((l) => excluded.some((re) => re.test(l.path)))) continue;
      findings.push({
        ruleId: rule.id,
        ruleVersion: rule.version,
        key: raw.key,
        message: raw.message,
        locations: raw.locations,
        evidence: raw.evidence,
        fingerprint: "",
        reproduce: `rsp check --base ${ctx.base} --head ${ctx.head}${opts} --rule ${rule.id}`
      });
    }
  }
  findings.sort(compareFindings);
  assignFingerprints(findings);
  return {
    tool: { name: "rsp", version: VERSION },
    base: ctx.base,
    head: ctx.head,
    options,
    config: config?.path ?? null,
    rules: rules.map((r) => ({ id: r.id, version: r.version })).sort((a, b) => cmp(a.id, b.id)),
    findings,
    ...ctx.tests && { tests: { flaky: ctx.tests.head.flaky, incomplete: ctx.tests.head.incomplete } }
  };
}
function compareFindings(a, b) {
  const la = a.locations[0];
  const lb = b.locations[0];
  return cmp(la?.path ?? "", lb?.path ?? "") || (la?.line ?? 0) - (lb?.line ?? 0) || cmp(a.ruleId, b.ruleId) || cmp(a.message, b.message);
}
function assignFingerprints(findings) {
  const seen = /* @__PURE__ */ new Map();
  for (const f of findings) {
    const key = [f.ruleId, f.locations[0]?.path ?? "", f.evidence.trim()].join("\0");
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const hash = createHash("sha256").update(`${key}\0${n}`).digest("hex");
    f.fingerprint = hash.slice(0, 16);
  }
}
function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// src/junit.ts
var TESTCASE = /<testcase\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
var ATTR = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
function parseReport(xml) {
  const results = /* @__PURE__ */ new Map();
  const retried = /* @__PURE__ */ new Set();
  const text = withoutComments(xml.replace(/^\uFEFF/, ""));
  for (const m of text.matchAll(TESTCASE)) {
    const attrs2 = /* @__PURE__ */ new Map();
    for (const a of m[1].matchAll(ATTR)) attrs2.set(a[1], unescapeXml(a[3] ?? a[4] ?? ""));
    const name = attrs2.get("name");
    if (!name) continue;
    const body = (m[3] ?? "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
    const status = /<(failure|error)\b/.test(body) ? "failed" : /<skipped\b/.test(body) ? "skipped" : "passed";
    const id = [attrs2.get("classname") || attrs2.get("file"), name].filter(Boolean).join("::");
    if (status === "passed" && /<(rerunFailure|rerunError|flakyFailure|flakyError)\b/.test(body)) retried.add(id);
    results.set(id, combine(results.get(id), status));
  }
  const root = /<(testsuites|testsuite)\b(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/.exec(text);
  const complete = !root || root[2] === "/" || new RegExp(`</${root[1]}\\s*>$`).test(text.trimEnd());
  return { results, retried, complete };
}
function mergeRuns(files) {
  const results = /* @__PURE__ */ new Map();
  const failed = /* @__PURE__ */ new Set();
  const flaky = /* @__PURE__ */ new Set();
  const incomplete = [];
  for (const f of files) {
    const report = parseReport(f.xml);
    if (!report.complete) incomplete.push(f.path);
    report.retried.forEach((id) => flaky.add(id));
    for (const [id, status] of report.results) {
      if (status === "failed") failed.add(id);
      results.set(id, combine(results.get(id), status));
    }
  }
  for (const id of failed) if (results.get(id) === "passed") flaky.add(id);
  return { files: files.map((f) => f.path), results, flaky: [...flaky].sort(), incomplete };
}
function combine(a, b) {
  if (a === void 0) return b;
  if (a === "passed" || b === "passed") return "passed";
  if (a === "failed" || b === "failed") return "failed";
  return "skipped";
}
function withoutComments(xml) {
  let out = "";
  let at = 0;
  for (; ; ) {
    const open = xml.indexOf("<!--", at);
    if (open < 0) return out + xml.slice(at);
    out += xml.slice(at, open);
    const close = xml.indexOf("-->", open + 4);
    if (close < 0) return out;
    at = close + 3;
  }
}
function unescapeXml(s) {
  return s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
    const named = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
    if (e[0] !== "#") return named[e.toLowerCase()] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return code <= 1114111 ? String.fromCodePoint(code) : m;
  });
}

// src/coverage.ts
function parseCoverage(text) {
  const body = text.replace(/^﻿/, "");
  if (/^SF:/m.test(body)) return parseLcov(body);
  if (/<coverage\b/.test(body)) return parseCobertura(body);
  return void 0;
}
function parseLcov(text) {
  const out = /* @__PURE__ */ new Map();
  let lines;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      const file = line.slice(3);
      lines = out.get(file) ?? /* @__PURE__ */ new Map();
      out.set(file, lines);
    } else if (line === "end_of_record") {
      lines = void 0;
    } else if (lines && line.startsWith("DA:")) {
      const [n, hits] = line.slice(3).split(",");
      add(lines, Number(n), Number(hits));
    }
  }
  return out;
}
var ATTR2 = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
function attrs(tag) {
  const out = /* @__PURE__ */ new Map();
  for (const a of tag.matchAll(ATTR2)) out.set(a[1], unescapeXml(a[3] ?? a[4] ?? ""));
  return out;
}
function parseCobertura(xml) {
  const out = /* @__PURE__ */ new Map();
  const text = withoutComments(xml);
  const sources = [...text.matchAll(/<source>([^<]*)<\/source>/g)].map((m) => m[1].trim()).filter(Boolean);
  for (const cls of text.matchAll(/<class\b([^>]*)>([\s\S]*?)<\/class>/g)) {
    const filename = attrs(cls[1]).get("filename");
    if (!filename) continue;
    const name = filename.startsWith("/") || sources.length !== 1 ? filename : `${sources[0].replace(/\/$/, "")}/${filename}`;
    const lines = out.get(name) ?? /* @__PURE__ */ new Map();
    out.set(name, lines);
    for (const l of cls[2].matchAll(/<line\b([^>]*?)\/?>/g)) {
      const a = attrs(l[1]);
      add(lines, Number(a.get("number")), Number(a.get("hits")));
    }
  }
  return out;
}
function add(lines, n, hits) {
  if (!Number.isInteger(n) || n < 1 || !Number.isFinite(hits)) return;
  lines.set(n, Math.max(lines.get(n) ?? 0, hits));
}
function coverageByRepoPath(reports, repoFiles) {
  const out = /* @__PURE__ */ new Map();
  for (const report of reports) {
    for (const [written, lines] of report) {
      const path = written.replace(/\\/g, "/").replace(/^\.\//, "");
      let best;
      for (const f of repoFiles) {
        if ((path === f || path.endsWith(`/${f}`)) && (!best || f.length > best.length)) best = f;
      }
      if (!best) continue;
      const merged = out.get(best) ?? /* @__PURE__ */ new Map();
      out.set(best, merged);
      for (const [n, hits] of lines) add(merged, n, hits);
    }
  }
  return out;
}

// src/rules/js.ts
var JS_FILE = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts|vue|svelte)$/;
var STATIC_IMPORTS = [
  /^\s*import\s+(?:type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/,
  /^\s*import\s*['"]([^'"]+)['"]/,
  /^\s*export\s+(?:type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/,
  // Closing line of a multi-line import or export: `} from "pkg";`
  /^\s*\}\s*from\s*['"]([^'"]+)['"]/
];
var REQUIRE = /(?<![\w.$])require\(\s*['"]([^'"]+)['"]\s*\)/g;
function importedSpecifiers(line) {
  if (isCommentLine(line)) return [];
  const specs = [];
  for (const re of STATIC_IMPORTS) {
    const m = re.exec(line);
    if (m) specs.push(m[1]);
  }
  const code = blankStrings(line);
  for (const m of line.matchAll(REQUIRE)) {
    if (code.startsWith("require(", m.index)) specs.push(m[1]);
  }
  return specs;
}
function packageName(spec) {
  if (/^[./]/.test(spec) || spec.includes(":") || /^[#~$]/.test(spec) || spec.startsWith("@/")) return void 0;
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  return /^(@[\w.-]+\/)?[\w.-]+$/.test(name) ? name : void 0;
}
function isInTryBlock(lines, index) {
  let indent = indentation(lines[index] ?? "");
  for (let i = index - 1; i >= 0 && indent > 0; i--) {
    const l = lines[i];
    if (l.trim() === "" || isCommentLine(l)) continue;
    const ind = indentation(l);
    if (ind < indent) {
      if (/^(\}\s*)?(try|catch\b[^{]*)\s*\{\s*$/.test(l.trim())) return true;
      indent = ind;
    }
  }
  return false;
}
var ENV_READS = [
  /\b(?:process\.env|import\.meta\.env|Bun\.env)\??\.([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*(?:=[^=]|\?\?=|\|\|=|&&=))/g,
  /\b(?:process\.env|import\.meta\.env|Bun\.env)\??\.?\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\](?!\s*(?:=[^=]|\?\?=|\|\|=|&&=))/g,
  /\bDeno\.env\.get\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g
];
var ENV_DESTRUCTURE = /\{([^{}]*)\}\s*=\s*(?:process\.env|import\.meta\.env|Bun\.env)\b/;
var VITE_BUILTINS = /* @__PURE__ */ new Set(["MODE", "BASE_URL", "PROD", "DEV", "SSR"]);
function envVarReads(line) {
  if (isCommentLine(line)) return [];
  const code = line.replace(/\/\/.*$/, "");
  const blank = blankStrings(code);
  const names = [];
  for (const re of ENV_READS) {
    for (const m of code.matchAll(re)) {
      if (blank.startsWith(m[0].slice(0, 4), m.index)) names.push(m[1]);
    }
  }
  const d = ENV_DESTRUCTURE.exec(blank);
  if (d) {
    for (const part of d[1].split(",")) {
      const name = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(part)?.[1];
      if (name) names.push(name);
    }
  }
  return code.includes("import.meta.env") ? names.filter((n) => !VITE_BUILTINS.has(n)) : names;
}
function nonCodeLines(text) {
  const result = /* @__PURE__ */ new Set();
  const stack = [];
  let state = "code";
  let inClass = false;
  let prev;
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const top = stack[stack.length - 1];
    if (c === "\n") {
      line++;
      if (state === "line-comment" || state === "'" || state === '"' || state === "regex") state = "code";
      if (state === "block-comment" || state === "code" && top === "template") result.add(line);
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
      if (c === "\\" && text[i + 1] !== "\n") i++;
      else if (c === state) {
        state = "code";
        prev = "a";
      }
      continue;
    }
    if (state === "regex") {
      if (c === "\\" && text[i + 1] !== "\n") i++;
      else if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        state = "code";
        prev = "a";
      }
      continue;
    }
    if (top === "template") {
      if (c === "\\" && text[i + 1] !== "\n") i++;
      else if (c === "`") {
        stack.pop();
        prev = "a";
      } else if (c === "$" && text[i + 1] === "{") {
        stack.push(0);
        prev = "{";
        i++;
      }
      continue;
    }
    if (/\s/.test(c)) continue;
    if (c === "/" && text[i + 1] === "/") state = "line-comment";
    else if (c === "/" && text[i + 1] === "*") {
      state = "block-comment";
      i++;
    } else if (c === "/" && startsRegex(text, i, prev)) {
      state = "regex";
      inClass = false;
    } else if (c === "'" || c === '"') state = c;
    else if (c === "`") stack.push("template");
    else if (typeof top === "number" && c === "{") stack[stack.length - 1] = top + 1;
    else if (typeof top === "number" && c === "}") {
      if (top === 0) stack.pop();
      else stack[stack.length - 1] = top - 1;
    }
    if (state === "code" && c !== "`") prev = c;
  }
  return result;
}
var BEFORE_REGEX_WORDS = /* @__PURE__ */ new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "void",
  "yield",
  "await",
  "delete",
  "instanceof",
  "new"
]);
function startsRegex(text, index, prev) {
  if (prev === void 0 || "(,=:[!&|?{};+-*%<>~^".includes(prev)) return true;
  if (!/[\w$]/.test(prev)) return false;
  const word = /([\w$]+)\s*$/.exec(text.slice(Math.max(0, index - 20), index))?.[1];
  return word !== void 0 && BEFORE_REGEX_WORDS.has(word);
}
function blankStrings(line) {
  let out = "";
  let quote;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") {
        out += "  ";
        i++;
      } else if (c === quote) {
        out += c;
        quote = void 0;
      } else if (quote === "`" && c === "$" && line[i + 1] === "{") {
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
function closingBrace(line, from) {
  let depth = 0;
  for (let i = from; i < line.length; i++) {
    if (line[i] === "{") depth++;
    else if (line[i] === "}" && depth-- === 0) return i;
  }
  return line.length - 1;
}
function isCommentLine(line) {
  return /^\s*(\/\/|\/\*|\*)/.test(line);
}
function indentation(line) {
  return line.length - line.trimStart().length;
}

// src/rules/python.ts
var IMPORT = /^\s*import\s+(.+)$/;
var FROM_IMPORT = /^\s*from\s+([\w.]+)\s+import\b/;
function importedModules(line) {
  const code = stripComment(line);
  const from = FROM_IMPORT.exec(code);
  if (from) return from[1].startsWith(".") ? [] : [from[1].split(".")[0]];
  const imp = IMPORT.exec(code);
  if (!imp) return [];
  return imp[1].replace(/[()\\]/g, "").split(",").map((part) => part.trim().split(/\s+/)[0].split(".")[0]).filter((name) => /^[A-Za-z_]\w*$/.test(name));
}
function enclosingHeaders(lines, index) {
  const headers = [];
  let indent = indentation2(lines[index] ?? "");
  for (let i = index - 1; i >= 0 && indent > 0; i--) {
    const l = lines[i];
    if (l.trim() === "" || l.trim().startsWith("#")) continue;
    const ind = indentation2(l);
    if (ind < indent) {
      headers.push({ index: i, text: l.trim() });
      indent = ind;
    }
  }
  return headers;
}
var TYPE_CHECKING_IF = /^if\s+(?:[\w.]+\.)?TYPE_CHECKING\b/;
function isGuardedImport(lines, index) {
  return enclosingHeaders(lines, index).some(
    (h) => TYPE_CHECKING_IF.test(h.text) || /^(try|except\b.*|finally)\s*:/.test(h.text) || isTryElse(lines, h)
  );
}
function isTryElse(lines, header) {
  if (!/^else\s*:/.test(header.text)) return false;
  const indent = indentation2(lines[header.index]);
  for (let i = header.index - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.trim() === "" || indentation2(l) > indent) continue;
    return /^except\b/.test(l.trim());
  }
  return false;
}
function optionalModules(lines) {
  const names = /* @__PURE__ */ new Set();
  lines.forEach((line, i) => {
    if (isGuardedImport(lines, i)) importedModules(line).forEach((m) => names.add(m));
  });
  return names;
}
var ENV_READS2 = [
  /\b(?:os\.)?getenv\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  /\b(?:os\.)?environ\.get\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  /\b(?:os\.)?environ\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\](?!\s*=[^=])/g
];
function envVarReads2(line) {
  const code = stripComment(line);
  const names = [];
  for (const re of ENV_READS2) {
    for (const m of code.matchAll(re)) names.push(m[1]);
  }
  return names;
}
function normalizeDist(name) {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}
function indentation2(line) {
  return line.length - line.trimStart().length;
}
function stripComment(line) {
  let quote;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = void 0;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}
function stringLines(text) {
  const out = /* @__PURE__ */ new Set();
  let line = 1;
  let quote;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n") {
      line++;
      if (quote && quote.length === 1) quote = void 0;
      if (quote) out.add(line);
      continue;
    }
    if (quote) {
      if (c === "\\" && text[i + 1] !== "\n") i++;
      else if (text.startsWith(quote, i)) {
        i += quote.length - 1;
        quote = void 0;
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
function blankStrings2(line) {
  let out = "";
  let quote;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") {
        out += "  ";
        i++;
      } else if (line.startsWith(quote, i)) {
        out += quote;
        i += quote.length - 1;
        quote = void 0;
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

// src/text.ts
function codeSpan(s) {
  const text = s.replace(/[\r\n]+/g, " ");
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") || text.startsWith(" ") && text.endsWith(" ") && text.trim() ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

// src/rules/checks-disabled.ts
var PYTHON_PATTERNS = [
  { id: "pytest-skip", label: "pytest skip marker", regex: /@pytest\.mark\.skip(if)?\b/ },
  { id: "pytest-xfail", label: "pytest xfail marker", regex: /@pytest\.mark\.xfail\b/ },
  { id: "pytest-skip-call", label: "pytest.skip() call", regex: /\bpytest\.skip\s*\(/ },
  { id: "unittest-skip", label: "unittest skip decorator", regex: /@unittest\.(skip|skipIf|skipUnless|expectedFailure)\b/ },
  { id: "noqa", label: "noqa comment", regex: /#\s*noqa\b/i },
  { id: "type-ignore", label: "type: ignore comment", regex: /#\s*type:\s*ignore\b/ },
  { id: "pylint-disable", label: "pylint disable comment", regex: /#\s*pylint:\s*disable\b/ },
  { id: "coverage-exclusion", label: "coverage exclusion", regex: /#\s*pragma:\s*no\s*cover\b/ },
  { id: "nosec", label: "bandit nosec comment", regex: /#\s*nosec\b/ }
];
var JS_PATTERNS = [
  { id: "eslint-disable", label: "eslint-disable comment", regex: /(\/\/|\/\*)\s*(eslint|oxlint)-disable\b/ },
  { id: "ts-ignore", label: "@ts-ignore comment", regex: /(\/\/|\/\*)\s*@ts-ignore\b/ },
  { id: "ts-nocheck", label: "@ts-nocheck comment", regex: /(\/\/|\/\*)\s*@ts-nocheck\b/ },
  { id: "ts-expect-error", label: "@ts-expect-error comment", regex: /(\/\/|\/\*)\s*@ts-expect-error\b/ },
  { id: "biome-ignore", label: "biome-ignore comment", regex: /(\/\/|\/\*)\s*biome-ignore\b/ },
  { id: "coverage-exclusion", label: "coverage exclusion", regex: /(\/\/|\/\*)\s*(istanbul|c8|v8)\s+ignore\b/ }
];
var JS_TEST_PATTERNS = [
  { id: "test-skip", label: "skipped test (`.skip`)", regex: /(^|[^\w.$])(describe|it|test|context|suite)\.(skip|skipIf|fixme)\b/ },
  { id: "test-only", label: "focused test (`.only`), which skips the others", regex: /(^|[^\w.$])(describe|it|test|context|suite)\.only\b/ },
  { id: "test-skip", label: "skipped test (`x` prefix)", regex: /(^|[^\w.$])x(describe|it|test|context)\s*\(/ }
];
var WORKFLOW_PATTERNS = [
  { id: "continue-on-error", label: "continue-on-error: true", regex: /^\s*continue-on-error:\s*true\b/ },
  { id: "or-true", label: "`|| true` after a command", regex: /\|\|\s*true\b/ },
  { id: "or-exit-0", label: "`|| exit 0` after a command", regex: /\|\|\s*exit\s+0\b/ },
  { id: "if-false", label: "step or job disabled with `if: false`", regex: /^\s*-?\s*if:\s*(false|\$\{\{\s*false\s*\}\})\s*$/ }
];
var TEST_CONFIG_PATTERNS = [
  { id: "pytest-exclude-option", label: "pytest option that excludes tests", regex: /--deselect\b|--ignore(-glob)?\b|(^|\s)-p\s+no:/ }
];
var PACKAGE_JSON_PATTERNS = [
  { id: "or-true", label: "`|| true` after a command", regex: /\|\|\s*true\b/ },
  { id: "or-exit-0", label: "`|| exit 0` after a command", regex: /\|\|\s*exit\s+0\b/ }
];
var TSCONFIG_PATTERNS = [
  {
    id: "ts-strict-off",
    label: "TypeScript check turned off",
    regex: /"(strict|noImplicitAny|strictNullChecks|strictFunctionTypes|strictBindCallApply|noImplicitThis|alwaysStrict|noImplicitReturns|noUnusedLocals|noUnusedParameters|noUncheckedIndexedAccess|noFallthroughCasesInSwitch)"\s*:\s*false\b/
  }
];
var ESLINT_CONFIG_PATTERNS = [
  { id: "eslint-rule-off", label: "ESLint rule turned off", regex: /['"]?[\w@/-]+['"]?\s*:\s*\[?\s*(['"]off['"]|0\s*[,\]}]|0\s*$)/ }
];
var CHECK_KIND = {
  pytest: "test",
  unittest: "test",
  tox: "test",
  nox: "test",
  jest: "test",
  vitest: "test",
  mocha: "test",
  ava: "test",
  playwright: "test",
  cypress: "test",
  "test script": "test",
  "node --test": "test",
  "deno test": "test",
  "bun test": "test",
  ruff: "lint",
  flake8: "lint",
  pylint: "lint",
  eslint: "lint",
  oxlint: "lint",
  biome: "lint",
  "lint script": "lint",
  mypy: "types",
  pyright: "types",
  tsc: "types",
  "typecheck script": "types",
  "type-check script": "types",
  black: "format",
  isort: "format",
  prettier: "format"
};
var CHECK_COMMAND = new RegExp(
  "\\b(pytest|tox|nox|ruff|flake8|mypy|pyright|pylint|black|isort|bandit|coverage|unittest|jest|vitest|mocha|ava|eslint|oxlint|tsc|prettier|playwright|cypress|biome)\\b|\\b(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?(test|lint|typecheck|type-check|check)\\b|\\b(node)(?:\\s+-[^\\s&|;]+(?:\\s+[^-\\s&|;][^\\s&|;]*)?)*?\\s+--test\\b|\\b(deno|bun)\\s+test\\b"
);
var CHECK_COMMAND_ALL = new RegExp(CHECK_COMMAND.source, "g");
var COVERAGE_THRESHOLD = /(?:fail_under|fail-under|--cov-fail-under)\s*[=:]?\s*["']?(\d+(?:\.\d+)?)/;
var PYTHON_ASSERTION = /^\s*assert\b|\bself\.assert[A-Z]\w*\(|\bpytest\.raises\(/;
var JS_ASSERTION = /\bexpect\(|(^|[^\w.$])assert(\.\w+)?\(|\bt\.(is|not|deepEqual|true|false|throws|equal|ok)\(/;
var PYTHON_TEST_FILE = /(^|\/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py)$/;
var JS_TEST_NAME = /\.(test|spec|e2e|test-d|tst)\.[cm]?[jt]sx?$/;
var JS_TEST_DIR = /(^|\/)(__tests__|tests?|e2e|cypress|spec)\/.*\.[cm]?[jt]sx?$/;
var JS_TEST_CALL = /(^|[^\w.$])(describe|it|test)\s*\(/;
var WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/;
var TEST_CONFIG_FILE = /(^|\/)(pyproject\.toml|setup\.cfg|pytest\.ini|tox\.ini|\.coveragerc)$/;
var TSCONFIG_FILE = /(^|\/)[jt]sconfig[\w.-]*\.json$/;
var ESLINT_CONFIG_FILE = /(^|\/)(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.(json|js|cjs|yml|yaml))?)$/;
var KNOWN_KEYS = [
  .../* @__PURE__ */ new Set([
    ...[PYTHON_PATTERNS, JS_PATTERNS, JS_TEST_PATTERNS, WORKFLOW_PATTERNS, TEST_CONFIG_PATTERNS].flat().map((p) => p.id),
    ...[PACKAGE_JSON_PATTERNS, TSCONFIG_PATTERNS, ESLINT_CONFIG_PATTERNS].flat().map((p) => p.id),
    "test-file-deleted",
    "fewer-assertions",
    "ci-check-removed",
    "coverage-threshold-lowered",
    "script-check-removed"
  ])
].sort();
var checksDisabled = {
  id: "checks/disabled",
  version: "0.3.0",
  keys: "a pattern id, e.g. `type-ignore` or `eslint-disable`",
  knownKeys: KNOWN_KEYS,
  description: "Checks that were removed or switched off: deleted test files, fewer assertions, skip markers, lint and type suppressions, CI steps or package.json scripts removed or allowed to fail, lower coverage thresholds, TypeScript and ESLint checks turned off.",
  run(ctx) {
    const findings = [];
    const removedSource = multiset(ctx.files.filter((f) => isSource(f.path) || isSource(f.oldPath)), "del");
    for (const file of ctx.files) {
      if (file.binary) continue;
      if (file.path.endsWith(".py")) findings.push(...pythonFile(ctx, file, removedSource));
      if (JS_FILE.test(file.path)) findings.push(...jsFile(ctx, file, removedSource));
      if (WORKFLOW_FILE.test(file.path)) findings.push(...workflowFile(file));
      if (TEST_CONFIG_FILE.test(file.path)) findings.push(...testConfigFile(ctx, file));
      if (file.path.split("/").pop() === "package.json") findings.push(...packageJsonFile(ctx, file));
      if (TSCONFIG_FILE.test(file.path)) findings.push(...matchAdded(file, TSCONFIG_PATTERNS));
      if (ESLINT_CONFIG_FILE.test(file.path)) findings.push(...matchAdded(file, ESLINT_CONFIG_PATTERNS));
    }
    findings.push(...fewerAssertions(ctx));
    return findings;
  }
};
function pythonFile(ctx, file, removed) {
  if (file.status === "deleted") {
    return PYTHON_TEST_FILE.test(file.path) ? [{ key: "test-file-deleted", message: "Test file deleted", locations: [{ path: file.path }], evidence: `deleted: ${file.path}` }] : [];
  }
  const nonCode = stringLines(ctx.readHead(file.path) ?? "");
  return matchAdded(file, PYTHON_PATTERNS, removed, (l) => nonCode.has(l.newLine) ? "" : blankStrings2(l.text));
}
function jsFile(ctx, file, removed) {
  if (file.status === "deleted") {
    return isJsTestFile(file.path, ctx.readBase(file.path)) ? [{ key: "test-file-deleted", message: "Test file deleted", locations: [{ path: file.path }], evidence: `deleted: ${file.path}` }] : [];
  }
  const inTests = JS_TEST_NAME.test(file.path) || JS_TEST_DIR.test(file.path);
  const patterns = inTests ? [...JS_PATTERNS.filter((p) => p.id !== "ts-expect-error"), ...JS_TEST_PATTERNS] : JS_PATTERNS;
  const nonCode = nonCodeLines(ctx.readHead(file.path) ?? "");
  return matchAdded(file, patterns, removed, (l) => nonCode.has(l.newLine) ? "" : blankStrings(l.text));
}
function packageJsonFile(ctx, file) {
  const findings = matchAdded(file, PACKAGE_JSON_PATTERNS);
  if (file.status === "deleted") return findings;
  const before = scripts(ctx.readBase(file.oldPath));
  const after = scripts(ctx.readHead(file.path));
  if (!before || !after) return findings;
  const stillRun = new Set(Object.values(after).flatMap(checkCommands).map(kind));
  const lines = (ctx.readHead(file.path) ?? "").split("\n");
  for (const [name, command] of Object.entries(before)) {
    const lost = checkCommands(command).filter((c) => !stillRun.has(kind(c)));
    if (lost.length === 0) continue;
    const now = after[name];
    const index = lines.findIndex((l) => l.trimStart().startsWith(`${JSON.stringify(name)}:`));
    findings.push(
      now === void 0 ? {
        key: "script-check-removed",
        message: `Removed package.json script ${codeSpan(name)}, which ran ${lost.map((c) => codeSpan(c)).join(", ")}`,
        locations: [{ path: file.path }],
        evidence: `"${name}": ${JSON.stringify(command)}`
      } : {
        key: "script-check-removed",
        message: `package.json script ${codeSpan(name)} no longer runs ${lost.map((c) => codeSpan(c)).join(", ")}`,
        locations: [{ path: file.path, line: index >= 0 ? index + 1 : void 0 }],
        evidence: index >= 0 ? lines[index].trim() : `"${name}": ${JSON.stringify(now)}`
      }
    );
  }
  return findings;
}
function scripts(text) {
  try {
    const json = JSON.parse(text ?? "");
    return Object.fromEntries(Object.entries(json.scripts ?? {}).filter((e) => typeof e[1] === "string"));
  } catch {
    return void 0;
  }
}
function fewerAssertions(ctx) {
  const tests = ctx.files.filter(
    (f) => !f.binary && (isTestFile(f.path, ctx.readHead(f.path)) || isTestFile(f.oldPath, ctx.readBase(f.oldPath)))
  );
  const counts = tests.map((f) => ({
    file: f,
    before: f.status === "added" ? 0 : countAssertions(f.oldPath, ctx.readBase(f.oldPath)),
    after: f.status === "deleted" ? 0 : countAssertions(f.path, ctx.readHead(f.path))
  }));
  const total = (k) => counts.reduce((n, c) => n + c[k], 0);
  if (total("after") >= total("before")) return [];
  return counts.filter((c) => c.file.status !== "added" && c.file.status !== "deleted" && c.after < c.before).map((c) => ({
    key: "fewer-assertions",
    message: `Assertions in test file went from ${c.before} to ${c.after}`,
    locations: [{ path: c.file.path }],
    evidence: `assertions: ${c.before} -> ${c.after}`
  }));
}
function workflowFile(file) {
  const findings = matchAdded(file, WORKFLOW_PATTERNS);
  const addedKinds = new Set(
    file.lines.filter((l) => l.kind === "add").flatMap((l) => checkCommands(l.text).map(kind))
  );
  for (const l of file.lines) {
    if (l.kind !== "del") continue;
    const command = isShellLine(l.text) ? checkCommands(l.text)[0] : void 0;
    if (!command || addedKinds.has(kind(command))) continue;
    const what = file.status === "deleted" ? "Workflow running a check deleted" : "Removed CI line running a check";
    findings.push({
      // Removed lines exist only in base, so the line number is given as a base line.
      key: "ci-check-removed",
      message: `${what} (base line ${l.oldLine})`,
      locations: [{ path: file.oldPath }],
      evidence: l.text.trim()
    });
  }
  return findings;
}
function testConfigFile(ctx, file) {
  const findings = matchAdded(file, TEST_CONFIG_PATTERNS);
  const before = threshold(ctx.readBase(file.oldPath));
  const after = threshold(ctx.readHead(file.path));
  if (before !== void 0 && (after === void 0 || after < before)) {
    const line = file.lines.find((l) => l.kind === "add" && COVERAGE_THRESHOLD.test(l.text));
    findings.push({
      key: "coverage-threshold-lowered",
      message: `Coverage threshold went from ${before} to ${after ?? "none"}`,
      locations: [{ path: file.path, line: line?.newLine }],
      evidence: line?.text.trim() ?? `coverage threshold: ${before} -> none`
    });
  }
  return findings;
}
function matchAdded(file, patterns, removed = multiset([file], "del"), code = (l) => l.text) {
  const findings = [];
  for (const l of file.lines) {
    if (l.kind !== "add" || take(removed, l.text.trim())) continue;
    for (const p of patterns) {
      if (p.regex.test(code(l))) {
        findings.push({
          key: p.id,
          message: `Added ${p.label}`,
          locations: [{ path: file.path, line: l.newLine }],
          evidence: l.text.trim()
        });
      }
    }
  }
  return findings;
}
function isShellLine(line) {
  if (/^\s*(-\s*)?run:/.test(line)) return true;
  return !/^\s*(-\s*)?([\w-]+\s*:|[{[])/.test(line);
}
function checkCommands(line) {
  return [...line.matchAll(CHECK_COMMAND_ALL)].map((m) => m[1] ?? (m[2] ? `${m[2]} script` : m[3] ? "node --test" : `${m[4]} test`));
}
function isSource(path) {
  return path.endsWith(".py") || JS_FILE.test(path);
}
function kind(command) {
  return CHECK_KIND[command] ?? command;
}
function isTestFile(path, text) {
  return PYTHON_TEST_FILE.test(path) || isJsTestFile(path, text);
}
function isJsTestFile(path, text) {
  return JS_TEST_NAME.test(path) || JS_TEST_DIR.test(path) && JS_TEST_CALL.test(text ?? "");
}
function multiset(files, kind2) {
  const m = /* @__PURE__ */ new Map();
  for (const f of files) {
    for (const l of f.lines) if (l.kind === kind2) m.set(l.text.trim(), (m.get(l.text.trim()) ?? 0) + 1);
  }
  return m;
}
function take(m, text) {
  const n = m.get(text) ?? 0;
  if (n > 0) m.set(text, n - 1);
  return n > 0;
}
function countAssertions(path, text) {
  const assertion = path.endsWith(".py") ? PYTHON_ASSERTION : JS_ASSERTION;
  return (text ?? "").split("\n").filter((l) => assertion.test(l)).length;
}
function threshold(text) {
  const m = COVERAGE_THRESHOLD.exec(text ?? "");
  return m ? Number(m[1]) : void 0;
}

// src/rules/lockfiles.ts
var JS_DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
function jsDeclared(json) {
  const out = /* @__PURE__ */ new Map();
  for (const field of JS_DEPENDENCY_FIELDS) {
    const deps = json[field];
    const map = /* @__PURE__ */ new Map();
    if (deps && typeof deps === "object" && !Array.isArray(deps)) {
      for (const [name, range] of Object.entries(deps)) if (typeof range === "string") map.set(name, range);
    }
    out.set(field, map);
  }
  return out;
}
function parseJson(text) {
  try {
    const value = JSON.parse(text ?? "");
    return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
  } catch {
    return void 0;
  }
}
function npmLock(text, dir) {
  const json = parseJson(text);
  if (!json || json.lockfileVersion !== 2 && json.lockfileVersion !== 3) return void 0;
  const packages = json.packages;
  if (!packages || typeof packages !== "object") return void 0;
  const entry = packages[dir];
  if (!entry || typeof entry !== "object") return void 0;
  const declared = jsDeclared(entry);
  return { fields: JS_DEPENDENCY_FIELDS, range: (field, name) => declared.get(field).get(name), mirrors: true };
}
function pnpmLock(text, dir) {
  const version = /^lockfileVersion:\s*'?"?(\d+)/m.exec(text)?.[1];
  if (version !== "6" && version !== "9") return void 0;
  const lines = text.split("\n");
  const want = dir === "" ? "." : dir;
  const ranges = /* @__PURE__ */ new Map();
  let found = false;
  for (let start = lines.indexOf("importers:"); start >= 0; start = lines.indexOf("importers:", start + 1)) {
    let inImporter = false;
    let field;
    let name;
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "") continue;
      if (/^\S/.test(line)) break;
      const indent = line.length - line.trimStart().length;
      const key = unquote2(line.trim().replace(/:.*$/, ""));
      const value = line.includes(":") ? line.slice(line.indexOf(":") + 1).trim() : "";
      if (indent === 2) {
        inImporter = key === want;
        found ||= inImporter;
        field = void 0;
      } else if (!inImporter) {
        continue;
      } else if (indent === 4) {
        field = JS_DEPENDENCY_FIELDS.includes(key) ? key : void 0;
      } else if (indent === 6 && field) {
        name = key;
      } else if (indent === 8 && field && name && key === "specifier") {
        if (!ranges.has(field)) ranges.set(field, /* @__PURE__ */ new Map());
        ranges.get(field).set(name, unquote2(value));
      }
    }
  }
  if (!found) return void 0;
  const fields = ["dependencies", "devDependencies", "optionalDependencies"];
  return { fields, range: (f, n) => ranges.get(f)?.get(n), mirrors: true };
}
function yarnLock(text) {
  if (!/^# yarn lockfile v1$/m.test(text) && !/^__metadata:$/m.test(text)) return void 0;
  const specs = /* @__PURE__ */ new Set();
  for (const line of text.split("\n")) {
    if (!/^\S.*:$/.test(line) || line.startsWith("#") || line.startsWith("__metadata")) continue;
    for (const part of line.slice(0, -1).split(",")) specs.add(part.trim().replace(/^["']|["']$/g, ""));
  }
  return {
    fields: ["dependencies", "devDependencies", "optionalDependencies"],
    has: (name, range) => specs.has(`${name}@${range}`) || specs.has(`${name}@npm:${range}`),
    mirrors: false
  };
}
function unquote2(s) {
  return s.replace(/^(['"])(.*)\1$/, "$2");
}
function uvLock(text, project, dir) {
  const doc = toml(text);
  if (!doc || !Array.isArray(doc.package)) return void 0;
  const want = dir === "" ? "." : dir;
  const pkg = doc.package.find(
    (p) => normalizeDist(String(p?.name ?? "")) === normalizeDist(project) && (p?.source?.editable === want || p?.source?.virtual === want)
  );
  const meta = pkg?.metadata;
  if (!meta || typeof meta !== "object") return void 0;
  const names = /* @__PURE__ */ new Set();
  const addAll = (list) => {
    if (Array.isArray(list)) {
      for (const r of list) if (typeof r?.name === "string") names.add(normalizeDist(r.name));
    }
  };
  addAll(meta["requires-dist"]);
  const dev = meta["requires-dev"];
  if (dev && typeof dev === "object") Object.values(dev).forEach(addAll);
  return { names, mirrors: true };
}
function packageListLock(text) {
  const doc = toml(text);
  if (!doc || !Array.isArray(doc.package)) return void 0;
  const names = /* @__PURE__ */ new Set();
  for (const p of doc.package) if (typeof p?.name === "string") names.add(normalizeDist(p.name));
  return { names, mirrors: false };
}
function pipfileLock(text) {
  const json = parseJson(text);
  if (!json || !json._meta) return void 0;
  const names = /* @__PURE__ */ new Set();
  for (const section of [json.default, json.develop]) {
    if (section && typeof section === "object") Object.keys(section).forEach((n) => names.add(normalizeDist(n)));
  }
  return { names, mirrors: false };
}
function toml(text) {
  try {
    return parse(text);
  } catch {
    return void 0;
  }
}

// src/rules/deps-lockfile.ts
var JS_LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"];
var PY_LOCKFILES = ["uv.lock", "poetry.lock", "pdm.lock"];
var LOCAL_RANGE = /^(workspace:|file:|link:|portal:|patch:|git|github:|https?:|catalog:)|\//;
var depsLockfile = {
  id: "deps/lockfile",
  version: "0.1.0",
  keys: "the package name, e.g. `zod` or `httpx`",
  description: "Dependencies added, changed or removed in package.json, pyproject.toml or Pipfile by the diff that the lockfile next to them (package-lock.json, pnpm-lock.yaml, yarn.lock, uv.lock, poetry.lock, pdm.lock, Pipfile.lock) does not match. Only lockfiles that existed at base and that rsp can read.",
  run(ctx) {
    const findings = [];
    for (const file of ctx.files) {
      if (file.binary || file.status !== "modified") continue;
      const name = file.path.split("/").pop();
      if (name === "package.json") findings.push(...javascript(ctx, file));
      else if (name === "pyproject.toml") findings.push(...pyproject(ctx, file));
      else if (name === "Pipfile") findings.push(...pipfile(ctx, file));
    }
    return findings;
  }
};
function dirOf(path) {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
}
function nearestLock(ctx, manifest, names) {
  let dir = dirOf(manifest);
  for (; ; ) {
    const present = names.filter((n) => ctx.readHead(dir + n) !== void 0 && ctx.readBase(dir + n) !== void 0);
    if (present.length > 1) return void 0;
    if (present.length === 1) return { path: dir + present[0], dir };
    if (dir === "") return void 0;
    dir = dirOf(dir.slice(0, -1));
  }
}
function addedLine(file, pattern) {
  const l = file.lines.find((x) => x.kind === "add" && pattern.test(x.text));
  return l && { line: l.newLine, text: l.text.trim() };
}
function removedLine(file, pattern) {
  return file.lines.find((x) => x.kind === "del" && pattern.test(x.text))?.text.trim();
}
function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function javascript(ctx, file) {
  const before = parseJson(ctx.readBase(file.oldPath));
  const after = parseJson(ctx.readHead(file.path));
  if (!before || !after) return [];
  const lock = nearestLock(ctx, file.path, JS_LOCKFILES);
  if (!lock) return [];
  const text = ctx.readHead(lock.path);
  const lockName = lock.path.split("/").pop();
  const rel = dirOf(file.path).slice(lock.dir.length).replace(/\/$/, "");
  const view = lockName === "pnpm-lock.yaml" ? pnpmLock(text, rel) : lockName === "yarn.lock" ? yarnLock(text) : npmLock(text, rel);
  if (!view) return [];
  const old = jsDeclared(before);
  const now = jsDeclared(after);
  const findings = [];
  const at = (line) => [{ path: file.path, ...line !== void 0 && { line } }, { path: lock.path }];
  for (const field of JS_DEPENDENCY_FIELDS) {
    if (!view.fields.includes(field)) continue;
    for (const [name, range] of now.get(field)) {
      if (old.get(field).get(name) === range || LOCAL_RANGE.test(range)) continue;
      const quoted = new RegExp(`"${escape(name)}"\\s*:`);
      const added = addedLine(file, quoted);
      if (!added) continue;
      if (view.range) {
        const recorded = view.range(field, name);
        if (recorded === range) continue;
        findings.push({
          key: name,
          message: recorded === void 0 ? `Declares ${codeSpan(name)} ${codeSpan(range)} in ${field}; ${lockName} does not list it` : `Declares ${codeSpan(name)} ${codeSpan(range)} in ${field}; ${lockName} records ${codeSpan(recorded)}`,
          locations: at(added.line),
          evidence: added.text
        });
      } else if (view.has && !view.has(name, range)) {
        findings.push({
          key: name,
          message: `Declares ${codeSpan(name)} ${codeSpan(range)} in ${field}; ${lockName} has no entry for ${codeSpan(`${name}@${range}`)}`,
          locations: at(added.line),
          evidence: added.text
        });
      }
    }
    if (!view.mirrors || !view.range) continue;
    for (const [name, range] of old.get(field)) {
      if (now.get(field).has(name) || LOCAL_RANGE.test(range)) continue;
      const removed = removedLine(file, new RegExp(`"${escape(name)}"\\s*:`));
      if (!removed || view.range(field, name) === void 0) continue;
      findings.push({
        key: name,
        message: `Removes ${codeSpan(name)} from ${field}; ${lockName} still lists it`,
        locations: at(void 0),
        evidence: removed
      });
    }
  }
  return findings;
}
function pyprojectNames(text) {
  let doc;
  try {
    doc = parse(text ?? "");
  } catch {
    return void 0;
  }
  const names = /* @__PURE__ */ new Set();
  const requirement = (r) => {
    const m = typeof r === "string" ? /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(r) : null;
    if (m) names.add(normalizeDist(m[1]));
  };
  const list = (v) => Array.isArray(v) && v.forEach(requirement);
  const lists = (v) => v && typeof v === "object" && Object.values(v).forEach(list);
  const table = (v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).forEach(requirement);
  list(doc.project?.dependencies);
  lists(doc.project?.["optional-dependencies"]);
  lists(doc["dependency-groups"]);
  list(doc.tool?.uv?.["dev-dependencies"]);
  lists(doc.tool?.pdm?.["dev-dependencies"]);
  const poetry = doc.tool?.poetry;
  table(poetry?.dependencies);
  table(poetry?.["dev-dependencies"]);
  if (poetry?.group && typeof poetry.group === "object") for (const g of Object.values(poetry.group)) table(g?.dependencies);
  names.delete("python");
  return { project: typeof doc.project?.name === "string" ? doc.project.name : void 0, names, poetry: !!poetry };
}
function pyproject(ctx, file) {
  const before = pyprojectNames(ctx.readBase(file.oldPath));
  const after = pyprojectNames(ctx.readHead(file.path));
  if (!before || !after) return [];
  const lock = nearestLock(ctx, file.path, PY_LOCKFILES);
  if (!lock) return [];
  const text = ctx.readHead(lock.path);
  const lockName = lock.path.split("/").pop();
  let view;
  if (lockName === "uv.lock") {
    if (!after.project) return [];
    view = uvLock(text, after.project, dirOf(file.path).slice(lock.dir.length).replace(/\/$/, ""));
  } else {
    if (lock.dir !== dirOf(file.path)) return [];
    view = packageListLock(text);
  }
  return view ? compareNames(file, lock.path, lockName, before.names, after.names, view, /[A-Za-z0-9][A-Za-z0-9._-]*/g) : [];
}
function pipfile(ctx, file) {
  const names = (text) => {
    try {
      const doc = parse(text ?? "");
      const out = /* @__PURE__ */ new Set();
      for (const t of [doc.packages, doc["dev-packages"]]) if (t && typeof t === "object") Object.keys(t).forEach((n) => out.add(normalizeDist(n)));
      return out;
    } catch {
      return void 0;
    }
  };
  const before = names(ctx.readBase(file.oldPath));
  const after = names(ctx.readHead(file.path));
  const lockPath = `${dirOf(file.path)}Pipfile.lock`;
  if (!before || !after || ctx.readBase(lockPath) === void 0 || ctx.readHead(lockPath) === void 0) return [];
  const view = pipfileLock(ctx.readHead(lockPath));
  return view ? compareNames(file, lockPath, "Pipfile.lock", before, after, view, /[A-Za-z0-9][A-Za-z0-9._-]*/g) : [];
}
function compareNames(file, lockPath, lockName, before, after, view, word) {
  const mentions2 = (text, name) => [...text.matchAll(word)].some((m) => normalizeDist(m[0]) === name);
  const findings = [];
  const manifest = file.path.split("/").pop();
  for (const name of [...after].sort()) {
    if (before.has(name) || view.names.has(name)) continue;
    const added = file.lines.find((l) => l.kind === "add" && mentions2(l.text, name));
    if (!added) continue;
    findings.push({
      key: name,
      message: `Declares ${codeSpan(name)} in ${manifest}; ${lockName} does not list it`,
      locations: [{ path: file.path, line: added.newLine }, { path: lockPath }],
      evidence: added.text.trim()
    });
  }
  if (!view.mirrors) return findings;
  for (const name of [...before].sort()) {
    if (after.has(name) || !view.names.has(name)) continue;
    const removed = file.lines.find((l) => l.kind === "del" && mentions2(l.text, name));
    if (!removed) continue;
    findings.push({
      key: name,
      message: `Removes ${codeSpan(name)} from ${manifest}; ${lockName} still lists it`,
      locations: [{ path: file.path }, { path: lockPath }],
      evidence: removed.text.trim()
    });
  }
  return findings;
}

// src/rules/js-builtins.ts
var NODE_BUILTINS = /* @__PURE__ */ new Set([
  "_http_agent",
  "_http_client",
  "_http_common",
  "_http_incoming",
  "_http_outgoing",
  "_http_server",
  "_stream_duplex",
  "_stream_passthrough",
  "_stream_readable",
  "_stream_transform",
  "_stream_wrap",
  "_stream_writable",
  "_tls_common",
  "_tls_wrap",
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib"
]);

// src/rules/js-manifests.ts
var DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
function jsManifests(ctx) {
  const packages = [];
  const local = /* @__PURE__ */ new Set();
  const aliases = [];
  for (const path of ctx.listHead()) {
    const base = path.split("/").pop();
    if (base === "package.json") {
      const json = parseJson2(ctx.readHead(path));
      if (!json) continue;
      const names = /* @__PURE__ */ new Set();
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
    aliases
  };
}
function parseJson2(text) {
  try {
    const value = JSON.parse(text ?? "");
    return value && typeof value === "object" ? value : void 0;
  } catch {
    return void 0;
  }
}
function pathAliases(text) {
  const at = text.search(/"paths"\s*:\s*\{/);
  if (at < 0) return [];
  const body = text.slice(text.indexOf("{", at) + 1, text.indexOf("}", at));
  return [...body.matchAll(/"([^"]+)"\s*:\s*\[/g)].map((m) => m[1].replace(/\*$/, ""));
}

// src/rules/python-manifests.ts
var REQUIREMENTS = /(^|\/)(requirements[^/]*\.(txt|in)|requirements\/[^/]+\.(txt|in))$/;
var REQUIREMENT_NAME = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/;
var ENVIRONMENT_YML = /(^|\/)environment\.ya?ml$/;
var INCLUDE = /^\s*(?:-r|--requirement|-c|--constraint)(?:\s+|=)(\S+)/;
function declaredDependencies(ctx) {
  const manifests = [];
  const dynamic = [];
  const names = /* @__PURE__ */ new Set();
  const add2 = (requirement) => {
    const m = REQUIREMENT_NAME.exec(requirement);
    if (m) names.add(normalizeDist(m[1]));
  };
  const requirements = new Set(ctx.listHead().filter((p) => REQUIREMENTS.test(p)));
  for (const path of requirements) {
    for (const target of includes(path, ctx.readHead(path) ?? "")) {
      if (ctx.readHead(target) !== void 0) requirements.add(target);
    }
  }
  for (const path of [.../* @__PURE__ */ new Set([...ctx.listHead(), ...requirements])].sort()) {
    const base = path.split("/").pop();
    let found;
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
    if (found === void 0) continue;
    manifests.push(path);
    found.forEach(add2);
  }
  return { manifests, names, dynamic };
}
function fromPyproject(text) {
  let doc;
  try {
    doc = parse(text);
  } catch {
    return [];
  }
  const out = [];
  const list = (v) => {
    if (Array.isArray(v)) {
      for (const item of v) if (typeof item === "string") out.push(item);
    }
  };
  const table = (v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...Object.keys(v));
  };
  const lists = (v) => {
    if (v && typeof v === "object") Object.values(v).forEach(list);
  };
  list(doc.project?.dependencies);
  lists(doc.project?.["optional-dependencies"]);
  lists(doc["dependency-groups"]);
  const poetry = doc.tool?.poetry;
  table(poetry?.dependencies);
  table(poetry?.["dev-dependencies"]);
  if (poetry?.group) for (const g of Object.values(poetry.group)) table(g?.dependencies);
  lists(doc.tool?.pdm?.["dev-dependencies"]);
  list(doc.tool?.uv?.["dev-dependencies"]);
  return out.filter((n) => normalizeDist(n) !== "python");
}
function fromRequirements(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    const egg = /#egg=([A-Za-z0-9._-]+)/.exec(raw);
    if (egg) out.push(egg[1]);
    else if (!line.startsWith("-") && !/^[a-z+]+:\/\//.test(line)) out.push(line);
  }
  return out;
}
function includes(path, text) {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  const out = [];
  for (const line of text.split("\n")) {
    const m = INCLUDE.exec(line);
    if (!m || /^[a-z+]+:\/\//.test(m[1])) continue;
    const parts = [];
    for (const part of `${dir}${m[1]}`.split("/")) {
      if (part === "..") parts.pop();
      else if (part !== "." && part !== "") parts.push(part);
    }
    out.push(parts.join("/"));
  }
  return out;
}
function fromPipfile(text) {
  let doc;
  try {
    doc = parse(text);
  } catch {
    return [];
  }
  const out = [];
  for (const table of [doc.packages, doc["dev-packages"]]) {
    if (table && typeof table === "object") out.push(...Object.keys(table));
  }
  return out;
}
function fromEnvironmentYml(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = /^\s*-\s+([A-Za-z0-9][A-Za-z0-9._-]*)(?:\s*[=<>!~\[]|\s*$)/.exec(line);
    if (m && !/:\s*$/.test(line)) out.push(m[1].replace(/^conda-forge::/, ""));
  }
  return out;
}
function fromSetupCfg(text) {
  const out = [];
  let section = "";
  let collecting = false;
  for (const line of text.split("\n")) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) {
      section = header[1].trim();
      collecting = false;
      continue;
    }
    if (/^\s/.test(line)) {
      const item = line.trim();
      if (collecting && item && !item.startsWith("#")) out.push(item);
      continue;
    }
    const kv = /^([\w.-]+)\s*[=:]\s*(.*)$/.exec(line);
    collecting = !!kv && (section === "options" && /^(install_requires|tests_require)$/.test(kv[1]) || section === "options.extras_require");
    if (collecting && kv[2].trim()) out.push(kv[2].trim());
  }
  return out;
}
function fromSetupPy(text) {
  const out = [];
  for (const s of text.matchAll(/(["'])([A-Za-z0-9][A-Za-z0-9._-]*(?:\[[\w,\s-]*\])?\s*(?:[<>=!~;@][^"'\n]*)?)\1/g)) {
    out.push(s[2]);
  }
  return out;
}
function setupPyIsDynamic(text) {
  for (const m of text.matchAll(/\b(install_requires|extras_require|tests_require)\s*=\s*([^\s,)]+)/g)) {
    const value = m[2];
    if (/^[[{]/.test(value)) continue;
    if (/^[A-Za-z_]\w*$/.test(value) && new RegExp(`^${value}\\s*=\\s*[[{]`, "m").test(text)) continue;
    return true;
  }
  return false;
}

// src/rules/python-stdlib.ts
var PYTHON_STDLIB = /* @__PURE__ */ new Set([
  "__future__",
  "_abc",
  "_aix_support",
  "_android_support",
  "_apple_support",
  "_ast",
  "_asyncio",
  "_bisect",
  "_blake2",
  "_bz2",
  "_codecs",
  "_codecs_cn",
  "_codecs_hk",
  "_codecs_iso2022",
  "_codecs_jp",
  "_codecs_kr",
  "_codecs_tw",
  "_collections",
  "_collections_abc",
  "_colorize",
  "_compat_pickle",
  "_compression",
  "_contextvars",
  "_csv",
  "_ctypes",
  "_curses",
  "_curses_panel",
  "_datetime",
  "_dbm",
  "_decimal",
  "_elementtree",
  "_frozen_importlib",
  "_frozen_importlib_external",
  "_functools",
  "_gdbm",
  "_hashlib",
  "_heapq",
  "_imp",
  "_interpchannels",
  "_interpqueues",
  "_interpreters",
  "_io",
  "_ios_support",
  "_json",
  "_locale",
  "_lsprof",
  "_lzma",
  "_markupbase",
  "_md5",
  "_multibytecodec",
  "_multiprocessing",
  "_opcode",
  "_opcode_metadata",
  "_operator",
  "_osx_support",
  "_overlapped",
  "_pickle",
  "_posixshmem",
  "_posixsubprocess",
  "_py_abc",
  "_pydatetime",
  "_pydecimal",
  "_pyio",
  "_pylong",
  "_pyrepl",
  "_queue",
  "_random",
  "_scproxy",
  "_sha1",
  "_sha2",
  "_sha3",
  "_signal",
  "_sitebuiltins",
  "_socket",
  "_sqlite3",
  "_sre",
  "_ssl",
  "_stat",
  "_statistics",
  "_string",
  "_strptime",
  "_struct",
  "_suggestions",
  "_symtable",
  "_sysconfig",
  "_thread",
  "_threading_local",
  "_tkinter",
  "_tokenize",
  "_tracemalloc",
  "_typing",
  "_uuid",
  "_warnings",
  "_weakref",
  "_weakrefset",
  "_winapi",
  "_wmi",
  "_zoneinfo",
  "abc",
  "aifc",
  "antigravity",
  "argparse",
  "array",
  "ast",
  "asynchat",
  "asyncio",
  "asyncore",
  "atexit",
  "audioop",
  "base64",
  "bdb",
  "binascii",
  "bisect",
  "builtins",
  "bz2",
  "cProfile",
  "calendar",
  "cgi",
  "cgitb",
  "chunk",
  "cmath",
  "cmd",
  "code",
  "codecs",
  "codeop",
  "collections",
  "colorsys",
  "compileall",
  "concurrent",
  "configparser",
  "contextlib",
  "contextvars",
  "copy",
  "copyreg",
  "crypt",
  "csv",
  "ctypes",
  "curses",
  "dataclasses",
  "datetime",
  "dbm",
  "decimal",
  "difflib",
  "dis",
  "distutils",
  "doctest",
  "email",
  "encodings",
  "ensurepip",
  "enum",
  "errno",
  "faulthandler",
  "fcntl",
  "filecmp",
  "fileinput",
  "fnmatch",
  "fractions",
  "ftplib",
  "functools",
  "gc",
  "genericpath",
  "getopt",
  "getpass",
  "gettext",
  "glob",
  "graphlib",
  "grp",
  "gzip",
  "hashlib",
  "heapq",
  "hmac",
  "html",
  "http",
  "idlelib",
  "imaplib",
  "imghdr",
  "imp",
  "importlib",
  "inspect",
  "io",
  "ipaddress",
  "itertools",
  "json",
  "keyword",
  "lib2to3",
  "linecache",
  "locale",
  "logging",
  "lzma",
  "mailbox",
  "mailcap",
  "marshal",
  "math",
  "mimetypes",
  "mmap",
  "modulefinder",
  "msilib",
  "msvcrt",
  "multiprocessing",
  "netrc",
  "nis",
  "nntplib",
  "nt",
  "ntpath",
  "nturl2path",
  "numbers",
  "opcode",
  "operator",
  "optparse",
  "os",
  "ossaudiodev",
  "pathlib",
  "pdb",
  "pickle",
  "pickletools",
  "pipes",
  "pkgutil",
  "platform",
  "plistlib",
  "poplib",
  "posix",
  "posixpath",
  "pprint",
  "profile",
  "pstats",
  "pty",
  "pwd",
  "py_compile",
  "pyclbr",
  "pydoc",
  "pydoc_data",
  "pyexpat",
  "queue",
  "quopri",
  "random",
  "re",
  "readline",
  "reprlib",
  "resource",
  "rlcompleter",
  "runpy",
  "sched",
  "secrets",
  "select",
  "selectors",
  "shelve",
  "shlex",
  "shutil",
  "signal",
  "site",
  "smtpd",
  "smtplib",
  "sndhdr",
  "socket",
  "socketserver",
  "spwd",
  "sqlite3",
  "sre_compile",
  "sre_constants",
  "sre_parse",
  "ssl",
  "stat",
  "statistics",
  "string",
  "stringprep",
  "struct",
  "subprocess",
  "sunau",
  "symtable",
  "sys",
  "sysconfig",
  "syslog",
  "tabnanny",
  "tarfile",
  "telnetlib",
  "tempfile",
  "termios",
  "textwrap",
  "this",
  "threading",
  "time",
  "timeit",
  "tkinter",
  "token",
  "tokenize",
  "tomllib",
  "trace",
  "traceback",
  "tracemalloc",
  "tty",
  "turtle",
  "turtledemo",
  "types",
  "typing",
  "unicodedata",
  "unittest",
  "urllib",
  "uu",
  "uuid",
  "venv",
  "warnings",
  "wave",
  "weakref",
  "webbrowser",
  "winreg",
  "winsound",
  "wsgiref",
  "xdrlib",
  "xml",
  "xmlrpc",
  "zipapp",
  "zipfile",
  "zipimport",
  "zlib",
  "zoneinfo"
]);

// src/rules/deps-undeclared.ts
var KNOWN_DISTRIBUTIONS = {
  attr: ["attrs"],
  bs4: ["beautifulsoup4"],
  cv2: ["opencv-python", "opencv-python-headless", "opencv-contrib-python", "opencv-contrib-python-headless"],
  Crypto: ["pycryptodome", "pycrypto"],
  Cryptodome: ["pycryptodomex"],
  dateutil: ["python-dateutil"],
  docx: ["python-docx"],
  dotenv: ["python-dotenv"],
  fitz: ["pymupdf"],
  git: ["gitpython"],
  google: ["protobuf", "google-api-python-client", "google-cloud-storage", "google-auth"],
  jose: ["python-jose"],
  jwt: ["pyjwt"],
  magic: ["python-magic"],
  multipart: ["python-multipart"],
  MySQLdb: ["mysqlclient"],
  OpenSSL: ["pyopenssl"],
  PIL: ["pillow"],
  pptx: ["python-pptx"],
  psycopg2: ["psycopg2-binary"],
  serial: ["pyserial"],
  skimage: ["scikit-image"],
  sklearn: ["scikit-learn"],
  slugify: ["python-slugify"],
  telegram: ["python-telegram-bot"],
  websocket: ["websocket-client"],
  yaml: ["pyyaml"],
  _pytest: ["pytest"],
  zmq: ["pyzmq"]
};
var depsUndeclared = {
  id: "deps/undeclared",
  version: "0.4.0",
  keys: "the imported module (Python) or package (JavaScript), e.g. `boto3`",
  description: "Python and JavaScript/TypeScript imports added in the diff whose package is not declared in a dependency manifest.",
  run(ctx) {
    return [...python(ctx), ...javascript2(ctx)];
  }
};
var PYTHON_TEST_PATH = /(^|\/)(tests?|testing)\/|(^|\/)(test_[^/]*|[^/]*_test|conftest)\.py$/;
var TEST_RUNNERS = /* @__PURE__ */ new Set(["pytest", "_pytest"]);
function python(ctx) {
  const pyFiles = ctx.files.filter((f) => !f.binary && f.status !== "deleted" && f.path.endsWith(".py"));
  if (pyFiles.length === 0) return [];
  const declared = declaredDependencies(ctx);
  if (declared.manifests.length === 0 || declared.dynamic.length > 0) return [];
  const local = localModules(ctx.listHead());
  const where2 = declared.manifests.length <= 3 ? declared.manifests.join(", ") : `any of ${declared.manifests.length} dependency manifests`;
  const findings = [];
  for (const file of pyFiles) {
    const text = ctx.readHead(file.path) ?? "";
    const optional = optionalModules(text.split("\n"));
    const inStrings = stringLines(text);
    const runners = PYTHON_TEST_PATH.test(file.path) ? TEST_RUNNERS : /* @__PURE__ */ new Set();
    for (const l of file.lines) {
      if (l.kind !== "add" || inStrings.has(l.newLine)) continue;
      for (const mod of importedModules(l.text)) {
        if (PYTHON_STDLIB.has(mod) || local.has(mod) || optional.has(mod) || runners.has(mod)) continue;
        if (candidates(mod).some((c) => declared.names.has(c))) continue;
        findings.push({
          key: mod,
          message: `Imports ${codeSpan(mod)}, not declared in ${where2}`,
          locations: [{ path: file.path, line: l.newLine }],
          evidence: l.text.trim()
        });
      }
    }
  }
  return findings;
}
function javascript2(ctx) {
  const jsFiles = ctx.files.filter((f) => !f.binary && f.status !== "deleted" && JS_FILE.test(f.path));
  if (jsFiles.length === 0) return [];
  const manifests = jsManifests(ctx);
  const local = localModules(ctx.listHead());
  const findings = [];
  for (const file of jsFiles) {
    const packages = manifests.forFile(file.path);
    if (packages.length === 0) continue;
    const text = ctx.readHead(file.path) ?? "";
    const lines = text.split("\n");
    const nonCode = nonCodeLines(text);
    const where2 = packages.slice(0, 3).map((p) => p.path).join(", ");
    for (const l of file.lines) {
      if (l.kind !== "add" || nonCode.has(l.newLine)) continue;
      for (const spec of importedSpecifiers(l.text)) {
        const name = packageName(spec);
        if (!name || NODE_BUILTINS.has(name) || NODE_BUILTINS.has(spec) || local.has(name)) continue;
        if (manifests.local.has(name) || manifests.aliases.some((a) => spec === a || a.endsWith("/") && spec.startsWith(a))) continue;
        if (packages.some((p) => p.names.has(name) || p.names.has(typesPackage(name)))) continue;
        if (isInTryBlock(lines, l.newLine - 1)) continue;
        findings.push({
          key: name,
          message: `Imports ${codeSpan(name)}, not declared in ${where2}`,
          locations: [{ path: file.path, line: l.newLine }],
          evidence: l.text.trim()
        });
      }
    }
  }
  return findings;
}
function typesPackage(name) {
  return `@types/${name.startsWith("@") ? name.slice(1).replace("/", "__") : name}`;
}
function candidates(mod) {
  const n = normalizeDist(mod);
  return [n, `python-${n}`, `py${n}`, ...KNOWN_DISTRIBUTIONS[mod] ?? []].map(normalizeDist);
}
function localModules(paths) {
  const names = /* @__PURE__ */ new Set();
  for (const p of paths) {
    const parts = p.split("/");
    const file = parts.pop();
    parts.forEach((d) => names.add(d));
    if (file.endsWith(".py")) names.add(file.slice(0, -3));
    if (file.endsWith(".pyi")) names.add(file.slice(0, -4));
    const js = /^(.+)\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/.exec(file);
    if (js) names.add(js[1]);
  }
  return names;
}

// src/rules/env-missing-example.ts
var EXAMPLE_FILE = /(^|\/)(\.env(\.[\w-]+)*[._-](example|sample|template|dist|defaults)|env\.example|example\.env|sample\.env)$/i;
var EXAMPLE_KEY = /^\s*#?\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
var STANDARD = /* @__PURE__ */ new Set([
  "CI",
  "DEBUG",
  "FORCE_COLOR",
  "HOME",
  "HOSTNAME",
  "LANG",
  "LANGUAGE",
  "LOGNAME",
  "NO_COLOR",
  "NODE_DEBUG",
  "NODE_ENV",
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "PATH",
  "PWD",
  "PYTHONHASHSEED",
  "PYTHONPATH",
  "SHELL",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "TZ",
  "USER",
  "VIRTUAL_ENV"
]);
var STANDARD_PREFIXES = ["GITHUB_", "RUNNER_", "LC_", "npm_"];
var envMissingExample = {
  id: "env/missing-example",
  version: "0.2.0",
  keys: "the variable name, e.g. `AWS_REGION`",
  description: "Environment variables read in added Python or JavaScript/TypeScript code but missing from the example env file.",
  run(ctx) {
    const sources = ctx.files.filter((f) => !f.binary && f.status !== "deleted" && envReader(f.path));
    if (sources.length === 0) return [];
    const examples = ctx.listHead().filter((p) => EXAMPLE_FILE.test(p));
    if (examples.length === 0) return [];
    const documented = /* @__PURE__ */ new Set();
    for (const path of examples) {
      for (const line of (ctx.readHead(path) ?? "").split("\n")) {
        const m = EXAMPLE_KEY.exec(line);
        if (m) documented.add(m[1]);
      }
    }
    const where2 = examples.length <= 3 ? examples.join(", ") : `any of ${examples.length} example env files`;
    const removedReads = new Set(
      ctx.files.flatMap((f) => {
        const read = envReader(f.oldPath);
        return read ? f.lines.filter((l) => l.kind === "del").flatMap((l) => read(l.text)) : [];
      })
    );
    const findings = [];
    for (const file of sources) {
      const read = envReader(file.path);
      const nonCode = JS_FILE.test(file.path) ? nonCodeLines(ctx.readHead(file.path) ?? "") : /* @__PURE__ */ new Set();
      for (const l of file.lines) {
        if (l.kind !== "add" || nonCode.has(l.newLine)) continue;
        for (const name of new Set(read(l.text))) {
          if (documented.has(name) || removedReads.has(name) || isStandard(name)) continue;
          findings.push({
            key: name,
            message: `Reads environment variable ${codeSpan(name)}, missing from ${where2}`,
            locations: [{ path: file.path, line: l.newLine }],
            evidence: l.text.trim()
          });
        }
      }
    }
    return findings;
  }
};
function isStandard(name) {
  return STANDARD.has(name) || STANDARD_PREFIXES.some((p) => name.startsWith(p));
}
function envReader(path) {
  if (path.endsWith(".py")) return envVarReads2;
  if (JS_FILE.test(path)) return envVarReads;
  return void 0;
}

// src/rules/interface-removed.ts
var PY_TOP_DEFINITION = /^(?:async\s+def|def|class)\s+([A-Za-z_]\w*)|^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/;
var JS_EXPORTED = [
  /^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*?|class|const|let|var|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/
];
var JS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
var interfaceRemoved = {
  id: "interface/removed-still-used",
  version: "0.1.0",
  keys: "the file and the name, e.g. `app/config.py:load_settings`",
  description: "Top-level functions, classes and constants (Python) or exports (JavaScript/TypeScript) that the diff removes from a module while another file still imports them by name at head.",
  run(ctx) {
    const removed = /* @__PURE__ */ new Map();
    for (const file of ctx.files) {
      if (file.binary || file.status !== "modified") continue;
      const names = file.path.endsWith(".py") ? removedPython(ctx, file) : JS_FILE.test(file.path) && !/\.(vue|svelte)$/.test(file.path) ? removedJs(ctx, file) : void 0;
      if (names && names.size > 0) removed.set(file.path, names);
    }
    if (removed.size === 0) return [];
    const head = ctx.listHead();
    const findings = [];
    for (const importer of head) {
      const isPy = importer.endsWith(".py");
      const isJs = JS_FILE.test(importer);
      if (!isPy && !isJs) continue;
      const text = ctx.readHead(importer);
      if (text === void 0) continue;
      const imports = isPy ? pythonImports(text, importer, head) : jsImports(text, importer, head);
      for (const imp of imports) {
        if (imp.module === importer) continue;
        const names = removed.get(imp.module);
        if (!names?.has(imp.name)) continue;
        findings.push({
          key: `${imp.module}:${imp.name}`,
          message: `Imports ${codeSpan(imp.name)} from ${codeSpan(imp.module)}, which no longer defines it`,
          locations: [{ path: importer, line: imp.line }],
          evidence: imp.evidence
        });
      }
    }
    return findings;
  }
};
function mentions(text, name) {
  return new RegExp(`(^|[^\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w$])`).test(text);
}
function removedPython(ctx, file) {
  const before = ctx.readBase(file.oldPath) ?? "";
  const after = ctx.readHead(file.path) ?? "";
  const out = /* @__PURE__ */ new Set();
  if (/^def\s+__getattr__\b|^from\s+\S+\s+import\s+\*|^\s*globals\(\)/m.test(after)) return out;
  const deleted = new Set(file.lines.filter((l) => l.kind === "del").map((l) => l.oldLine));
  const inStrings = stringLines(before);
  before.split("\n").forEach((line, i) => {
    if (!deleted.has(i + 1) || inStrings.has(i + 1)) return;
    const m = PY_TOP_DEFINITION.exec(line);
    const name = m?.[1] ?? m?.[2];
    if (name && name !== "__all__" && !mentions(after, name)) out.add(name);
  });
  if (file.path.endsWith("/__init__.py")) {
    const dir = file.path.slice(0, -"__init__.py".length);
    for (const p of ctx.listHead()) {
      if (!p.startsWith(dir)) continue;
      const sub = p.slice(dir.length).split("/")[0].replace(/\.py$/, "");
      out.delete(sub);
    }
  }
  return out;
}
function removedJs(ctx, file) {
  const before = ctx.readBase(file.oldPath) ?? "";
  const after = ctx.readHead(file.path) ?? "";
  const out = /* @__PURE__ */ new Set();
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
function unique(candidates2, head) {
  const found = [...new Set(candidates2.filter((c) => head.has(c)))];
  return found.length === 1 ? found[0] : void 0;
}
function normalize(path) {
  const parts = [];
  for (const part of path.split("/")) {
    if (part === "..") {
      if (parts.length === 0) return void 0;
      parts.pop();
    } else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}
function pythonImports(text, importer, headList) {
  const head = new Set(headList);
  const lines = text.split("\n");
  const inStrings = stringLines(text);
  const dir = importer.includes("/") ? importer.slice(0, importer.lastIndexOf("/")) : "";
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*from\s+(\.*)([\w.]*)\s+import\s+(.*)$/.exec(lines[i].replace(/#.*$/, ""));
    if (!m || inStrings.has(i + 1) || isGuardedImport(lines, i)) continue;
    const [, dots, dotted, rest] = m;
    let base;
    if (dots) {
      let up = dir;
      for (let d = 1; d < dots.length; d++) up = up.includes("/") ? up.slice(0, up.lastIndexOf("/")) : "";
      const rel = [up, dotted.replace(/\./g, "/")].filter(Boolean).join("/");
      base = [rel];
    } else {
      const path = dotted.replace(/\./g, "/");
      base = [path, `src/${path}`];
    }
    const module = unique(base.flatMap((b) => [`${b}.py`, `${b}/__init__.py`]), head);
    if (!module) continue;
    const parts = [{ text: rest, line: i }];
    if (rest.trim().startsWith("(") && !rest.includes(")")) {
      for (let j = i + 1; j < lines.length; j++) {
        parts.push({ text: lines[j].replace(/#.*$/, ""), line: j });
        if (lines[j].includes(")")) break;
      }
    } else if (rest.trim().endsWith("\\")) {
      for (let j = i + 1; j < lines.length; j++) {
        parts.push({ text: lines[j], line: j });
        if (!lines[j].trim().endsWith("\\")) break;
      }
    }
    for (const part of parts) {
      for (const item of part.text.replace(/[()\\]/g, "").split(",")) {
        const name = item.trim().split(/\s+/)[0];
        if (name && /^[A-Za-z_]\w*$/.test(name)) {
          out.push({ module, name, line: part.line + 1, evidence: lines[part.line].trim() });
        }
      }
    }
  }
  return out;
}
function jsImports(text, importer, headList) {
  const head = new Set(headList);
  const lines = text.split("\n");
  const nonCode = nonCodeLines(text);
  const dir = importer.includes("/") ? importer.slice(0, importer.lastIndexOf("/")) : "";
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (nonCode.has(i + 1) || !/^\s*(import|export)\b/.test(lines[i])) continue;
    let end = i;
    while (end < lines.length - 1 && end - i < 50 && !/\bfrom\s*['"][^'"]+['"]/.test(lines[end]) && !/;\s*$/.test(lines[end])) end++;
    let inText = false;
    for (let j = i + 1; j <= end; j++) inText ||= nonCode.has(j + 1);
    if (inText) continue;
    const statement = lines.slice(i, end + 1).join("\n");
    const m = /^\s*(import|export)\s+(?:type\s+)?([\s\S]*?)\s*\bfrom\s*['"](\.{1,2}\/[^'"]*)['"]/.exec(statement);
    if (!m) continue;
    const [, keyword, clause, spec] = m;
    const target = normalize([dir, spec].filter(Boolean).join("/"));
    if (target === void 0) continue;
    const stem = target.replace(/\.(m|c)?js$/, "");
    const module = unique(
      [target, ...JS_EXTENSIONS.map((e) => `${stem}${e}`), ...JS_EXTENSIONS.map((e) => `${target}/index${e}`)],
      head
    );
    if (!module) continue;
    const at = (name) => {
      for (let j = i; j <= end; j++) {
        if (mentions(lines[j], name)) return j;
      }
      return i;
    };
    const names = [];
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces) {
      for (const item of braces[1].split(",")) {
        const name = item.trim().replace(/^type\s+/, "").split(/\s+/)[0];
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.push(name === "default" ? "default" : name);
      }
    }
    if (keyword === "import" && /^[A-Za-z_$][\w$]*\s*(,|$)/.test(clause.trim())) names.push("default");
    for (const name of names) {
      const line = name === "default" ? i : at(name);
      out.push({ module, name, line: line + 1, evidence: lines[line].trim() });
    }
    i = end;
  }
  return out;
}

// src/rules/interface-routes.ts
var NOT_SERVED = /(^|\/)(tests?|__tests__|spec|e2e|examples?|docs?|fixtures?|benchmarks?|demo)\/|(^|\/)(test_[^/]*|[^/]*_test)\.py$|\.(test|spec)\.[cm]?[jt]sx?$/;
var PY_DECORATOR = /^\s*@\s*[A-Za-z_][\w.]*\.(route|get|post|put|patch|delete|head|options|websocket|api_route)\s*\(\s*[rRbBuU]?(["'])(\/[^"']*)\2([^)]*)/;
var DJANGO_PATH = /^\s*(?:path|re_path)\s*\(\s*[rR]?(["'])([^"']*)\1\s*,/;
var JS_ROUTE = /(?:^|[^\w$.])(app|router|server|fastify|api|routes?|[A-Za-z_$][\w$]*(?:Router|App|Server))\s*\.\s*(get|post|put|patch|delete|head|options|all)\s*\(\s*(["'`])(\/[^"'`$]*)\3\s*,/;
function routesOn(line, file) {
  const make = (method, path) => ({
    method,
    path,
    shape: `${method} ${path.replace(/<[^>]+>|\{[^}]+\}|:[A-Za-z_$][\w$]*(\([^)]*\))?\??/g, "{}")}`
  });
  if (file.endsWith(".py")) {
    const m2 = PY_DECORATOR.exec(line);
    if (m2) {
      const [, kind2, , path, rest] = m2;
      if (kind2 === "route" || kind2 === "api_route") {
        const methods = /methods\s*=\s*[[(]([^\])]*)[\])]/.exec(rest);
        if (/methods\s*=/.test(rest) && !methods) return [];
        const list = methods ? [...methods[1].matchAll(/["'](\w+)["']/g)].map((x) => x[1].toUpperCase()) : ["GET"];
        return list.map((method) => make(method, path));
      }
      return [make(kind2 === "websocket" ? "WEBSOCKET" : kind2.toUpperCase(), path)];
    }
    const d = /(^|\/)urls\.py$/.test(file) ? DJANGO_PATH.exec(line) : null;
    return d ? [make("ANY", `/${d[2].replace(/^\^?\/?/, "")}`)] : [];
  }
  const m = JS_ROUTE.exec(line);
  return m ? [make(m[2].toUpperCase(), m[4])] : [];
}
var interfaceRoutes = {
  id: "interface/route-removed",
  version: "0.1.0",
  keys: "the method and path as written, e.g. `GET /items/:id`",
  description: "HTTP routes declared with a literal path (Flask, FastAPI, Django, Express, Fastify and similar routers) that the diff removes, or whose method it changes, and that no file declares at head. Tests and examples are left out.",
  run(ctx) {
    const isSource2 = (p) => (p.endsWith(".py") || JS_FILE.test(p) && !/\.(vue|svelte)$/.test(p)) && !NOT_SERVED.test(p);
    const removed = [];
    for (const file of ctx.files) {
      if (file.binary || file.status === "added" || !isSource2(file.oldPath)) continue;
      const before = ctx.readBase(file.oldPath) ?? "";
      const nonCode = file.oldPath.endsWith(".py") ? stringLines(before) : nonCodeLines(before);
      for (const l of file.lines) {
        if (l.kind !== "del" || nonCode.has(l.oldLine)) continue;
        for (const route of routesOn(l.text, file.oldPath)) removed.push({ file: file.path, route, evidence: l.text.trim() });
      }
    }
    if (removed.length === 0) return [];
    const served = /* @__PURE__ */ new Set();
    for (const path of ctx.listHead()) {
      if (!isSource2(path)) continue;
      const text = ctx.readHead(path) ?? "";
      const nonCode = path.endsWith(".py") ? stringLines(text) : nonCodeLines(text);
      text.split("\n").forEach((line, i) => {
        if (!nonCode.has(i + 1)) for (const r of routesOn(line, path)) served.add(r.shape);
      });
    }
    const findings = [];
    const seen = /* @__PURE__ */ new Set();
    for (const { file, route, evidence } of removed) {
      const key = `${route.method} ${route.path}`;
      if (served.has(route.shape) || seen.has(`${file}\0${key}`)) continue;
      seen.add(`${file}\0${key}`);
      findings.push({
        key,
        message: `Removed route ${codeSpan(key)}; no file declares it at head`,
        locations: [{ path: file }],
        evidence
      });
    }
    return findings;
  }
};

// src/rules/signatures.ts
var PY_DEF = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
var PY_CLASS = /^class\s+([A-Za-z_]\w*)\b/;
function pythonSignatures(text) {
  const lines = text.split("\n");
  const inStrings = stringLines(text);
  const out = [];
  let cls;
  lines.forEach((line, i) => {
    if (inStrings.has(i + 1)) return;
    if (/^\S/.test(line) && !/^(@|#|\)|\])/.test(line)) {
      cls = PY_CLASS.exec(line)?.[1];
    }
    const m = PY_DEF.exec(line);
    if (!m) return;
    const indented = m[1].length > 0;
    const name = m[2];
    if (indented && !cls) return;
    if (cls && indented && m[1].length !== 4 && m[1] !== "	") return;
    if (!indented) cls = void 0;
    const owner = indented ? cls : void 0;
    if (owner?.startsWith("_") || name.startsWith("_") && name !== "__init__") return;
    const decorators = decoratorsAbove(lines, i);
    if (decorators.some((d) => /^@(\w+\.(setter|getter|deleter)|(functools\.)?(cached_)?property)\b/.test(d))) return;
    const raw = paramsFrom(lines, i, line.indexOf("(", m[0].length - 1), "#");
    if (raw === void 0) return;
    let params = splitParams(raw).map(pythonParam).filter((p) => p !== "");
    if (owner && (params[0] === "self" || params[0] === "cls")) params = params.slice(1);
    const overload = decorators.some((d) => /^@(typing\.|t\.|typing_extensions\.)?overload\b/.test(d));
    const after = closingParen(lines, i, line.indexOf("(", m[0].length - 1));
    const returns = after && /^\s*->\s*(.+?)\s*:\s*(#.*)?$/.exec(after)?.[1];
    out.push({ name: owner ? `${owner}.${name}` : name, params, shape: params.join(", "), line: i + 1, overload, ...returns && { returns: normalizeType(returns) } });
  });
  const lastPlain = new Map(out.filter((s) => !s.overload).map((s) => [s.name, s]));
  const explicit = mergeOverloads(out.filter((s) => s.overload || lastPlain.get(s.name) === s).map(({ overload: _, ...s }) => s));
  const fromFields = fieldConstructors(lines, inStrings).filter((f) => !explicit.some((e) => e.name === f.name));
  return [...explicit, ...fromFields];
}
var FIELD_CLASS_DECORATOR = /^@(dataclasses\.dataclass|dataclass|attr\.s|attr\.attrs|attrs\.define|attrs\.frozen|attr\.define|attr\.frozen|define|frozen)\b/;
var KEYWORD_MODEL = /\b(BaseModel|BaseSettings)\b/;
var FIELD = /^    ([A-Za-z_]\w*)\s*:\s*(.+?)(?:\s*=\s*(.+))?$/;
function fieldConstructors(lines, inStrings) {
  const out = [];
  lines.forEach((line, i) => {
    const cls = /^class\s+([A-Za-z_]\w*)\s*(\(([^)]*)\))?\s*:/.exec(line);
    if (!cls || inStrings.has(i + 1) || cls[1].startsWith("_")) return;
    const decorated = decoratorsAbove(lines, i).some((d) => FIELD_CLASS_DECORATOR.test(d));
    const model = KEYWORD_MODEL.test(cls[3] ?? "");
    if (!decorated && !model) return;
    const params = [];
    let first;
    let last = i + 1;
    for (let j = i + 1; j < lines.length; j++) {
      const body = lines[j];
      if (/^\S/.test(body) && !body.startsWith("#")) break;
      if (body.trim() === "" || inStrings.has(j + 1)) continue;
      last = j + 1;
      if (/^    (async\s+)?def\s+__init__\b/.test(body)) return;
      const f = FIELD.exec(body.replace(/\s+#.*$/, ""));
      if (!f || /^(typing\.)?ClassVar\b/.test(f[2]) || f[1] === "model_config") continue;
      first ??= j + 1;
      params.push(f[3] === void 0 ? f[1] : `${f[1]}=${f[3].trim()}`);
    }
    if (first === void 0) return;
    const shape = (model ? [...params].sort() : params).join(", ");
    out.push({ name: `${cls[1]}.__init__`, params, shape, line: i + 1, span: [first, last] });
  });
  return out;
}
function decoratorsAbove(lines, index) {
  const out = [];
  for (let i = index - 1; i >= 0 && lines[i].trim().startsWith("@"); i--) out.push(lines[i].trim());
  return out;
}
var JS_EXPORTED2 = [
  /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^(]*>)?\s*\(/,
  /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\s*\*?\s*[\w$]*\s*)?(?:<[^(]*>)?\s*\(/
];
function jsSignatures(text) {
  const lines = text.split("\n");
  const out = [];
  lines.forEach((line, i) => {
    for (const re of JS_EXPORTED2) {
      const m = re.exec(line);
      if (!m) continue;
      if (re === JS_EXPORTED2[1] && !isArrowOrFunction(lines, i, m[0].length - 1)) continue;
      const raw = paramsFrom(lines, i, m[0].length - 1, "//");
      if (raw === void 0) continue;
      const params = splitParams(raw).map(jsParam).filter((p) => p !== "" && p !== "this");
      const shape = params.map((p) => p.replace(/^(\.\.\.)?[A-Za-z_$][\w$]*/, "$1_")).join(", ");
      const returns = jsReturns(closingParen(lines, i, m[0].length - 1));
      out.push({ name: m[1], params, shape, line: i + 1, ...returns && { returns } });
      break;
    }
  });
  out.push(...classMethods(lines));
  return [...mergeOverloads(out), ...typeFields(lines)];
}
var JS_EXPORTED_TYPE = /^(\s*)export\s+(?:declare\s+)?(?:interface\s+([A-Za-z_$][\w$]*)\s*(?:<.*>)?\s*(extends\s+[^{]+)?\{\s*$|type\s+([A-Za-z_$][\w$]*)\s*(?:<.*>)?\s*=\s*\{\s*$)/;
var TYPE_MEMBER = /^(?:readonly\s+)?([A-Za-z_$][\w$]*|"[^"]+"|'[^']+')\s*(\?)?\s*[:(<]/;
function typeFields(lines) {
  const out = [];
  const seen = /* @__PURE__ */ new Map();
  lines.forEach((line, i) => {
    const t = JS_EXPORTED_TYPE.exec(line);
    if (!t) return;
    const name = t[2] ?? t[4];
    seen.set(name, (seen.get(name) ?? 0) + 1);
    const end = lines.findIndex((l, j) => j > i && l.startsWith(`${t[1]}}`));
    if (end < 0 || !/^\s*\};?\s*$/.test(lines[end])) return;
    const indent = lines.slice(i + 1, end).find((l) => l.trim() !== "")?.match(/^\s*/)?.[0];
    if (!indent) return;
    const params = [];
    let first;
    for (let j = i + 1; j < end; j++) {
      const member = lines[j];
      if (!member.startsWith(indent) || /^\s/.test(member.slice(indent.length))) continue;
      const text = member.trim();
      if (/^(\/\/|\/\*|\*)/.test(text)) continue;
      if (/^(\[|\(|<|new\b|get\s|set\s|\.\.\.)/.test(text)) return;
      const m = TYPE_MEMBER.exec(text);
      if (!m) return;
      first ??= j + 1;
      params.push(`${m[1].replace(/^["']|["']$/g, "")}${m[2] ?? ""}`);
    }
    if (first === void 0) return;
    const unique2 = [...new Set(params)].sort();
    out.push({ name, params: unique2, shape: unique2.join(", "), line: i + 1, span: [first, end], fields: true, ...t[3] && { extends: true } });
  });
  return out.filter((s) => seen.get(s.name) === 1);
}
function describeFields(before, after, inherits) {
  const required = (fields) => new Set(fields.filter((f) => !f.endsWith("?")));
  const names = (fields) => new Set(fields.map((f) => f.replace(/\?$/, "")));
  const oldNames = names(before);
  const oldRequired = required(before);
  const nowNames = names(after);
  const parts = [];
  const removed = inherits ? [] : [...oldNames].filter((f) => !nowNames.has(f));
  const added = [...required(after)].filter((f) => !oldNames.has(f));
  const madeRequired = [...required(after)].filter((f) => oldNames.has(f) && !oldRequired.has(f));
  if (removed.length) parts.push(`removed ${removed.map((f) => codeSpan(f)).join(", ")}`);
  if (added.length) parts.push(`added required ${added.map((f) => codeSpan(f)).join(", ")}`);
  if (madeRequired.length) parts.push(`made ${madeRequired.map((f) => codeSpan(f)).join(", ")} required`);
  return parts.length ? parts.join("; ") : void 0;
}
var JS_EXPORTED_CLASS = /^(\s*)export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
var JS_METHOD = /^\s*((?:(?:public|static|async|override|readonly)\s+)*)(constructor|[A-Za-z_$][\w$]*)\s*(?:<[^(]*>)?\s*\(/;
var NOT_METHODS = /* @__PURE__ */ new Set(["if", "for", "while", "switch", "return", "catch", "function", "get", "set", "super"]);
function classMethods(lines) {
  const out = [];
  lines.forEach((line, i) => {
    const cls = JS_EXPORTED_CLASS.exec(line);
    if (!cls) return;
    const end = lines.findIndex((l, j) => j > i && l.startsWith(`${cls[1]}}`));
    if (end < 0) return;
    const indent = lines.slice(i + 1, end).find((l) => l.trim() !== "")?.match(/^\s*/)?.[0];
    if (!indent) return;
    for (let j = i + 1; j < end; j++) {
      const member = lines[j];
      if (!member.startsWith(indent) || /^\s/.test(member.slice(indent.length))) continue;
      const m = JS_METHOD.exec(member);
      if (!m || NOT_METHODS.has(m[2]) || /\bstatic\b/.test(m[1])) continue;
      const open = m[0].length - 1;
      const rest = closingParen(lines, j, open);
      if (rest === void 0 || !/^\s*(:[^=;{]+)?\s*(\{.*|;)?\s*$/.test(rest)) continue;
      const raw = paramsFrom(lines, j, open, "//");
      if (raw === void 0) continue;
      const params = splitParams(raw).map(jsParam).filter((p) => p !== "" && p !== "this");
      const shape = params.map((p) => p.replace(/^(\.\.\.)?[A-Za-z_$][\w$]*/, "$1_")).join(", ");
      const returns = jsReturns(rest);
      out.push({ name: `${cls[2]}.${m[2]}`, params, shape, line: j + 1, ...returns && { returns } });
    }
  });
  return out;
}
function mergeOverloads(sigs) {
  const byName = /* @__PURE__ */ new Map();
  for (const s of sigs) {
    const prev = byName.get(s.name);
    if (!prev) byName.set(s.name, { ...s, shapes: /* @__PURE__ */ new Set([s.shape]) });
    else if (!prev.shapes.has(s.shape)) {
      prev.shapes.add(s.shape);
      byName.set(s.name, { ...prev, params: [...prev.params, "|", ...s.params], shape: `${prev.shape} | ${s.shape}` });
    }
    if (prev) delete byName.get(s.name).returns;
  }
  return [...byName.values()].map(({ shapes: _, ...s }) => s);
}
function describeChange(before, after, positional = false) {
  if (before.includes("|") || after.includes("|")) return `went from ${codeSpan(overloads(before))} to ${codeSpan(overloads(after))}`;
  if (positional) return describePositional(before, after);
  const name = (p) => p.split("=")[0].replace(/\?$/, "");
  const old = new Map(before.map((p) => [name(p), p]));
  const now = new Map(after.map((p) => [name(p), p]));
  const parts = [];
  const added = after.filter((p) => !old.has(name(p)));
  const removed = before.filter((p) => !now.has(name(p)));
  const changed = after.filter((p) => old.has(name(p)) && old.get(name(p)) !== p);
  if (added.length) parts.push(`added ${added.map((p) => codeSpan(p)).join(", ")}`);
  if (removed.length) parts.push(`removed ${removed.map((p) => codeSpan(p)).join(", ")}`);
  if (changed.length) parts.push(`changed ${changed.map((p) => `${codeSpan(old.get(name(p)))} to ${codeSpan(p)}`).join(", ")}`);
  if (parts.length === 0) parts.push(`changed order from \`(${before.join(", ")})\` to \`(${after.join(", ")})\``);
  return parts.join("; ");
}
function jsReturns(after) {
  const m = after === void 0 ? null : /^\s*:\s*(.+?)\s*(=>.*|\{.*|;)?\s*$/.exec(after);
  if (!m || /[{(<[|&,]$|^asserts\b|\bis\s/.test(m[1])) return void 0;
  return normalizeType(m[1]);
}
function normalizeType(type) {
  let t = type.replace(/\s+/g, " ").trim().replace(/^["']([^"']*)["']$/, "$1").replace(/\btyping(_extensions)?\./g, "");
  t = t.replace(/\b(List|Dict|Set|FrozenSet|Tuple|Type)\[/g, (_, g) => `${g.toLowerCase()}[`);
  for (let prev = ""; prev !== t; ) {
    prev = t;
    t = t.replace(/\bOptional\[([^[\]]*(?:\[[^[\]]*\])?[^[\]]*)\]/g, "$1 | None");
  }
  const members = splitTopLevelAll(t, "|");
  return members.length > 1 ? members.sort().join(" | ") : t;
}
function splitTopLevelAll(s, sep) {
  const parts = [];
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
function isArrowOrFunction(lines, index, open) {
  const before = lines[index].slice(0, open);
  if (/function\s*\*?\s*[\w$]*\s*(<[^(]*>)?\s*$/.test(before)) return true;
  const rest = closingParen(lines, index, open);
  return rest !== void 0 && /^\s*(:\s*[^=]+)?=>/.test(rest);
}
function closingParen(lines, index, open) {
  let depth = 0;
  for (let i = index; i < Math.min(lines.length, index + 50); i++) {
    const line = lines[i];
    for (let j = i === index ? open : 0; j < line.length; j++) {
      const c = line[j];
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) return line.slice(j + 1);
    }
  }
  return void 0;
}
function paramsFrom(lines, index, open, comment) {
  let depth = 0;
  let text = "";
  let quote;
  for (let i = index; i < Math.min(lines.length, index + 50); i++) {
    const line = lines[i];
    for (let j = i === index ? open : 0; j < line.length; j++) {
      const c = line[j];
      if (quote) {
        if (c === "\\") {
          text += c + (line[j + 1] ?? "");
          j++;
          continue;
        }
        if (c === quote) quote = void 0;
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
  return void 0;
}
function splitParams(raw) {
  const parts = [];
  let depth = 0;
  let quote;
  let cur = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      if (c === "\\") {
        cur += c + (raw[i + 1] ?? "");
        i++;
        continue;
      }
      if (c === quote) quote = void 0;
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
function pythonParam(param) {
  const [head, def] = splitTopLevel(param, "=");
  const name = splitTopLevel(head, ":")[0].trim();
  if (def?.trim() === "undefined") return name.endsWith("?") ? name : `${name}?`;
  return def === void 0 ? name : `${name}=${def.trim()}`;
}
function jsParam(param) {
  const [head, def] = splitTopLevel(param.replace(/\/\*[\s\S]*?\*\//g, " "), "=");
  let name = head.trim();
  if (!/^[{[]/.test(name)) name = splitTopLevel(name, ":")[0].trim();
  else name = name.replace(/\}\s*:.*$/s, "}").replace(/\]\s*:.*$/s, "]");
  name = name.replace(/^(public|private|protected|readonly)\s+/, "");
  if (def?.trim() === "undefined") return name.endsWith("?") ? name : `${name}?`;
  return def === void 0 ? name : `${name}=${def.trim()}`;
}
function splitTopLevel(s, sep) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ("([{<".includes(c)) depth++;
    else if (")]}>".includes(c) && !(c === ">" && s[i - 1] === "=")) depth--;
    else if (c === sep && depth === 0 && !(sep === "=" && (s[i + 1] === "=" || s[i + 1] === ">" || "!<>".includes(s[i - 1] ?? "")))) {
      return [s.slice(0, i), s.slice(i + 1)];
    }
  }
  return [s, void 0];
}
function overloads(params) {
  return `(${params.join(", ")})`.replace(/, \|, /g, ") | (");
}
function describePositional(before, after) {
  const shape = (p) => p.replace(/^(\.\.\.)?[A-Za-z_$][\w$]*/, "$1_");
  const parts = [];
  const changed = [];
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    if (shape(before[i]) !== shape(after[i])) changed.push(`${codeSpan(before[i])} to ${codeSpan(after[i])}`);
  }
  if (after.length > before.length) parts.push(`added ${after.slice(before.length).map((p) => codeSpan(p)).join(", ")}`);
  if (before.length > after.length) parts.push(`removed ${before.slice(after.length).map((p) => codeSpan(p)).join(", ")}`);
  if (changed.length) parts.push(`changed ${changed.join(", ")}`);
  return parts.join("; ");
}

// src/rules/interface-untested.ts
var PYTHON_TEST_FILE2 = /(^|\/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py)$/;
var JS_TEST_FILE = /(^|\/)(__tests__|tests?|e2e|spec)\/.*\.[cm]?[jt]sx?$|\.(test|spec|test-d)\.[cm]?[jt]sx?$/;
var PYTHON_TEST_DIR = /(^|\/)tests?\//;
var interfaceUntested = {
  id: "interface/untested-change",
  version: "0.2.0",
  keys: "the function or type name, e.g. `load_settings`, `Store.add` or `Settings`",
  description: "Public functions whose parameters changed (added, removed, reordered, new defaults, or renamed where callers pass them by name), and exported TypeScript object types whose fields were removed, added as required or made required, while no test file changed by the diff mentions them. Only in repositories that have tests.",
  run(ctx) {
    const head = ctx.listHead();
    if (!head.some(isTestFile2)) return [];
    const changedTests = ctx.files.filter((f) => f.status !== "deleted" && !f.binary && isTestFile2(f.path)).map((f) => ctx.readHead(f.path) ?? "");
    const findings = [];
    for (const file of ctx.files) {
      if (file.binary || file.status === "added" || file.status === "deleted") continue;
      if (isTestFile2(file.path) || PYTHON_TEST_DIR.test(file.path)) continue;
      const extract = signatureReader(file.path);
      if (!extract) continue;
      const id = (s) => `${s.fields ? "type" : "function"}:${s.name}`;
      const before = new Map(extract(ctx.readBase(file.oldPath) ?? "").map((s) => [id(s), s]));
      const touched = new Set(file.lines.filter((l) => l.kind === "add").map((l) => l.newLine));
      for (const sig of extract(ctx.readHead(file.path) ?? "")) {
        const old = before.get(id(sig));
        if (!old || !touchesDefinition(ctx, file.path, sig, touched)) continue;
        const returned = !sig.fields && old.returns && sig.returns && old.returns !== sig.returns;
        if (old.shape === sig.shape && !returned) continue;
        const changes = [];
        if (old.shape !== sig.shape) {
          const change = sig.fields ? describeFields(old.params, sig.params, !!(old.extends || sig.extends)) : describeChange(old.params, sig.params, !file.path.endsWith(".py"));
          if (change !== void 0) changes.push(change);
        }
        if (returned) changes.push(`${changes.length ? "return type " : ""}changed ${codeSpan(old.returns)} to ${codeSpan(sig.returns)}`);
        if (changes.length === 0) continue;
        const parts = sig.name.split(".");
        const bare = parts.length > 1 && (parts[1] === "__init__" || parts[1] === "constructor") ? parts[0] : parts[parts.length - 1];
        const word = new RegExp(`\\b${bare.replace(/\$/g, "\\$")}\\b`);
        if (changedTests.some((t) => word.test(t))) continue;
        findings.push({
          key: sig.name,
          message: `${sig.fields ? "Fields" : old.shape === sig.shape ? "Return type" : "Parameters"} of ${codeSpan(sig.name)}: ${changes.join("; ")}; no test changed by the diff mentions it`,
          locations: [{ path: file.path, line: sig.line }],
          evidence: (ctx.readHead(file.path) ?? "").split("\n")[sig.line - 1].trim()
        });
      }
    }
    return findings;
  }
};
function signatureReader(path) {
  if (path.endsWith(".py")) return pythonSignatures;
  if (JS_FILE.test(path) && !/\.(vue|svelte)$/.test(path)) return jsSignatures;
  return void 0;
}
function isTestFile2(path) {
  return PYTHON_TEST_FILE2.test(path) || JS_TEST_FILE.test(path);
}
function touchesDefinition(ctx, path, sig, touched) {
  if (sig.span) {
    for (let n = sig.span[0]; n <= sig.span[1]; n++) if (touched.has(n)) return true;
    return false;
  }
  const lines = (ctx.readHead(path) ?? "").split("\n");
  for (let n = sig.line; n <= Math.min(lines.length, sig.line + 50); n++) {
    if (touched.has(n)) return true;
    if (/\)\s*(->[^:]*)?:\s*(#.*)?$|\)\s*(:[^=]*)?(=>|\{)/.test(lines[n - 1])) return false;
  }
  return false;
}

// src/rules/tests-delta.ts
var testsDelta = {
  id: "tests/delta",
  version: "0.2.0",
  keys: "the test id, `classname::name` as in the JUnit report, or `no-tests`",
  description: "Differences between the test results at base and at head, read from JUnit reports: tests that pass at base and fail at head, tests that ran at base and are skipped or missing at head. Runs only when reports are given. Missing tests are not reported when a head report is cut off.",
  run(ctx) {
    if (!ctx.tests) return [];
    const { base, head } = ctx.tests;
    const where2 = head.files[0] ?? "junit";
    const finding = (key, message, evidence) => ({
      key,
      message,
      locations: [{ path: where2 }],
      evidence
    });
    const partial = head.incomplete.length > 0;
    if (head.results.size === 0 && base.results.size > 0 && !partial) {
      return [finding("no-tests", `No test results at head; ${base.results.size} at base`, `tests: ${base.results.size} -> 0`)];
    }
    const findings = [];
    for (const [id, now] of head.results) {
      const before = base.results.get(id);
      if (before === "passed" && now === "failed") {
        findings.push(finding(id, `Test ${codeSpan(id)} fails at head and passed at base`, `${id}: passed -> failed`));
      } else if (before !== void 0 && before !== "skipped" && now === "skipped") {
        findings.push(finding(id, `Test ${codeSpan(id)} is skipped at head and ran at base`, `${id}: ${before} -> skipped`));
      }
    }
    if (head.results.size < base.results.size && !partial) {
      for (const [id, before] of base.results) {
        if (head.results.has(id)) continue;
        findings.push(
          finding(
            id,
            `Test ${codeSpan(id)} ran at base and is missing at head (${base.results.size} tests at base, ${head.results.size} at head)`,
            `${id}: ${before} -> missing`
          )
        );
      }
    }
    return findings;
  }
};

// src/rules/tests-uncovered.ts
var NEVER_RUNS = /^(#|\/\/|\/\*|\*|$)|^(export\s+)?(declare\s+|interface\s|type\s+[\w$]+\s*(<.*>)?\s*=|import\s+type\b)/;
var testsUncovered = {
  id: "tests/uncovered-change",
  version: "0.1.0",
  keys: "the file path, e.g. `src/billing.py`",
  description: "Added lines that the coverage report of the tests at head measures and that did not run, counted per file: one fact per file. Runs only when coverage reports are given (LCOV or Cobertura).",
  run(ctx) {
    if (!ctx.coverage) return [];
    const deleted = new Set(ctx.files.flatMap((f) => f.lines.filter((l) => l.kind === "del").map((l) => l.text.trim())));
    const findings = [];
    for (const file of ctx.files) {
      if (file.binary || file.status === "deleted") continue;
      const hits = ctx.coverage.get(file.path);
      if (!hits) continue;
      const measured = file.lines.filter((l) => l.kind === "add" && hits.has(l.newLine) && !deleted.has(l.text.trim()) && !NEVER_RUNS.test(l.text.trim()));
      const missed = measured.filter((l) => hits.get(l.newLine) === 0);
      if (missed.length === 0) continue;
      findings.push({
        key: file.path,
        message: `${missed.length} of the ${measured.length} added ${measured.length === 1 ? "line" : "lines"} of ${codeSpan(file.path)} that the coverage report measures did not run in the tests at head`,
        locations: [{ path: file.path, line: missed[0].newLine }],
        evidence: missed[0].text.trim()
      });
    }
    return findings;
  }
};

// src/rules/index.ts
var ALL_RULES = [checksDisabled, depsLockfile, depsUndeclared, envMissingExample, interfaceRemoved, interfaceRoutes, interfaceUntested, testsDelta, testsUncovered];

// src/report/json.ts
function toJson(report) {
  return JSON.stringify(sortKeys(report), null, 2) + "\n";
}
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v !== void 0) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

// src/report/markdown.ts
function toMarkdown(report) {
  const range = `${short(report.base)}..${short(report.head)}`;
  const n = report.findings.length;
  const lines = [
    `### RSP \xB7 ${n} ${n === 1 ? "fact" : "facts"} on ${range} (rsp ${report.tool.version})`,
    ""
  ];
  if (n === 0) {
    const r = report.rules.length;
    lines.push(r === 1 ? "The one rule run found no facts in this diff." : `None of the ${r} rules found facts in this diff.`);
  } else {
    lines.push("| Rule | Where | Fact | Evidence |", "| --- | --- | --- | --- |");
    for (const f of report.findings) {
      lines.push(`| ${inline(f.ruleId)} | ${where(f)} | ${inline(f.message)} | ${cell(codeSpan(f.evidence))} |`);
    }
  }
  const flaky = report.tests?.flaky ?? [];
  if (flaky.length > 0) {
    const shown = flaky.slice(0, 20).map((id) => cell(codeSpan(id))).join(", ");
    const more = flaky.length > 20 ? ` and ${flaky.length - 20} more` : "";
    lines.push("", `Failed and also passed at head, not counted as failures: ${shown}${more}.`);
  }
  for (const file of report.tests?.incomplete ?? []) {
    lines.push("", `The head report ${codeSpan(file)} is cut off, so tests missing from it are not reported.`);
  }
  const opts = report.options.map((o) => ` ${o}`).join("");
  if (report.config) lines.push("", `Configuration: ${codeSpan(report.config)} from the base commit.`);
  lines.push(
    "",
    `Reproduce: ${codeSpan(`rsp check --base ${report.base} --head ${report.head}${opts}`)}`,
    "",
    `<sub>Install: \`npm install -g github:fedeveloper/rsp#v${report.tool.version}\`. Findings are facts about the diff, not a review: no findings does not mean the change is correct.</sub>`,
    ""
  );
  return lines.join("\n");
}
function where(f) {
  const loc = f.locations[0];
  if (!loc) return "";
  return cell(codeSpan(loc.line ? `${loc.path}:${loc.line}` : loc.path));
}
function inline(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const run = /^`+/.exec(s.slice(i));
    if (run) {
      const fence = run[0];
      const close = findClosing(s, i + fence.length, fence.length);
      if (close >= 0) {
        out += cell(s.slice(i, close + fence.length));
        i = close + fence.length;
      } else {
        out += "&#96;".repeat(fence.length);
        i += fence.length;
      }
      continue;
    }
    out += escapeText(s[i]);
    i++;
  }
  return out;
}
function findClosing(s, from, n) {
  for (const m of s.slice(from).matchAll(/`+/g)) {
    if (m[0].length === n) return from + m.index;
  }
  return -1;
}
function escapeText(c) {
  if (c === "<") return "&lt;";
  if (c === ">") return "&gt;";
  if (c === "&") return "&amp;";
  if (c === "@") return "&#64;";
  if (c === "|") return "&#124;";
  if (c === "\n" || c === "\r") return " ";
  return /[\\*_[\]()#!~]/.test(c) ? `\\${c}` : c;
}
function cell(s) {
  return s.split("|").join("\\|").replace(/[\r\n]+/g, " ");
}
function short(sha) {
  return sha.slice(0, 12);
}

// src/index.ts
function check(opts) {
  const exclude = [...new Set(opts.exclude ?? [])].sort();
  const ctx = buildContext(opts.repoDir, opts.base, opts.head ?? "HEAD", exclude);
  const text = opts.config === false ? void 0 : ctx.readBase(CONFIG_FILE);
  const config = text === void 0 ? void 0 : parseConfig(text, ALL_RULES);
  if (config && config.exclude.length > 0) {
    const excluded = config.exclude.map(globToRegExp);
    ctx.files = ctx.files.filter((f) => !excluded.some((re) => re.test(f.path) || re.test(f.oldPath)));
  }
  if (opts.junitBase?.length && opts.junitHead?.length) {
    const read = (paths) => mergeRuns(paths.map((path) => ({ path, xml: readFileSync(path, "utf8") })));
    ctx.tests = { base: read(opts.junitBase), head: read(opts.junitHead) };
  } else if (opts.junitBase?.length || opts.junitHead?.length) {
    throw new Error("JUnit reports must be given for both base and head");
  }
  if (opts.coverage?.length) {
    const reports = [];
    for (const path of opts.coverage) {
      const parsed = parseCoverage(readFileSync(path, "utf8"));
      if (!parsed) throw new Error(`${path} is not an LCOV or Cobertura coverage report`);
      reports.push(parsed);
    }
    ctx.coverage = coverageByRepoPath(reports, ctx.listHead());
  }
  const rules = opts.rules ? selectRules(opts.rules) : ALL_RULES.filter((r) => config?.rules[r.id]?.enabled !== false);
  const options = [
    ...exclude.map((g) => `--exclude ${shellQuote(g)}`),
    ...opts.config === false ? ["--no-config"] : [],
    ...(ctx.tests?.base.files ?? []).map((f) => `--junit-base ${shellQuote(f)}`),
    ...(ctx.tests?.head.files ?? []).map((f) => `--junit-head ${shellQuote(f)}`),
    ...(opts.coverage ?? []).map((f) => `--coverage ${shellQuote(f)}`)
  ];
  return runRules(ctx, rules, options, config);
}
function selectRules(ids) {
  const unknown = ids.filter((id) => !ALL_RULES.some((r) => r.id === id));
  if (unknown.length > 0) {
    throw new Error(`Unknown rule: ${unknown.join(", ")}. Known rules: ${ALL_RULES.map((r) => r.id).join(", ")}`);
  }
  return ALL_RULES.filter((r) => ids.includes(r.id));
}
function shellQuote(s) {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

// src/test-runner.ts
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync as readFileSync2, rmSync } from "node:fs";
import { join, relative } from "node:path";
function runTestsAtBaseAndHead(opts) {
  const head = resolveCommit(opts.repoDir, opts.head);
  const base = mergeBase(opts.repoDir, resolveCommit(opts.repoDir, opts.base), head);
  const reports = join(opts.workDir, "rsp-junit");
  mkdirSync(reports, { recursive: true });
  const coverage = [];
  const runAt = (label, commit, attempt) => {
    const dir = join(opts.workDir, `rsp-${label}`);
    if (attempt === 0) {
      rmSync(dir, { recursive: true, force: true });
      git(opts.repoDir, ["worktree", "add", "--detach", "--force", dir, commit]);
    }
    opts.log(`::group::rsp: tests at ${label} ${commit.slice(0, 12)}${attempt > 0 ? ` (rerun ${attempt})` : ""}`);
    const stop = randomBytes(16).toString("hex");
    opts.log(`::stop-commands::${stop}`);
    const res = spawnSync("bash", ["-c", opts.command], { cwd: dir, env: testEnv(process.env), stdio: ["ignore", "inherit", "inherit"] });
    opts.log(`::${stop}::`);
    opts.log(`::endgroup::`);
    opts.log(`rsp: test command at ${label} exited with ${res.status ?? res.signal}`);
    const found = findFiles(dir, globToRegExp(opts.junit));
    if (found.length === 0) opts.log(`::warning::rsp: the test command wrote no file matching ${opts.junit} at ${label}`);
    if (opts.coverage && label === "head" && attempt === 0) {
      const written = findFiles(dir, globToRegExp(opts.coverage));
      if (written.length === 0) opts.log(`::warning::rsp: the test command wrote no file matching ${opts.coverage} at head`);
      written.forEach((f, i) => {
        const target = join(reports, `coverage-${i}${f.endsWith(".xml") ? ".xml" : ".info"}`);
        copyFileSync(join(dir, f), target);
        coverage.push(target);
      });
    }
    return found.map((f, i) => {
      const target = join(reports, `${label}-${attempt}-${i}.xml`);
      copyFileSync(join(dir, f), target);
      return target;
    });
  };
  try {
    const junitBase = runAt("base", base, 0);
    const junitHead = runAt("head", head, 0);
    const read = (paths) => mergeRuns(paths.map((path) => ({ path, xml: readFileSync2(path, "utf8") })));
    const baseResults = read(junitBase).results;
    for (let attempt = 1; attempt <= opts.retries; attempt++) {
      const headResults = read(junitHead).results;
      const newFailures = [...headResults].filter(([id, s]) => s === "failed" && baseResults.get(id) === "passed");
      if (newFailures.length === 0) break;
      junitHead.push(...runAt("head", head, attempt));
    }
    return { junitBase, junitHead, coverage };
  } finally {
    for (const label of ["base", "head"]) {
      try {
        git(opts.repoDir, ["worktree", "remove", "--force", join(opts.workDir, `rsp-${label}`)]);
      } catch {
      }
    }
  }
}
function testEnv(env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (/^(INPUT_|ACTIONS_)/.test(key)) continue;
    if (/^GITHUB_(TOKEN|ENV|OUTPUT|PATH|STATE|STEP_SUMMARY)$/.test(key)) continue;
    out[key] = value;
  }
  return out;
}
function findFiles(root, pattern, dir = root, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === ".git" || entry === "node_modules" || entry === ".venv") continue;
    const path = join(dir, entry);
    const rel = relative(root, path);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) findFiles(root, pattern, path, out);
    else if (pattern.test(rel)) out.push(rel);
  }
  return out;
}

// src/action.ts
var COMMENT_MARKER = "<!-- rsp:report -->";
async function runAction(env = process.env, fetchImpl = fetch) {
  const input = (name) => (env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
  const list = (name) => input(name).split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const failOn = input("fail-on") || "never";
  if (failOn !== "never" && failOn !== "any") {
    log(`::error::fail-on must be "never" or "any", got "${failOn}"`);
    return 1;
  }
  const event = JSON.parse(readFileSync3(env.GITHUB_EVENT_PATH ?? "", "utf8"));
  const pr = event.pull_request;
  if (!pr) {
    log(`::notice::rsp checks pull requests; event "${env.GITHUB_EVENT_NAME}" has none, nothing to do.`);
    return 0;
  }
  const repoDir = env.GITHUB_WORKSPACE ?? process.cwd();
  const retries = Number(input("test-retries") || "1");
  if (!Number.isInteger(retries) || retries < 0) {
    log(`::error::test-retries must be a whole number, got "${input("test-retries")}"`);
    return 1;
  }
  let junit;
  if (input("test-command") && env.GITHUB_EVENT_NAME === "pull_request_target") {
    log("::error::test-command runs the pull request's code and is refused on pull_request_target; use the pull_request event.");
    return 1;
  }
  if (input("test-command")) {
    if (persistedCredentials(repoDir)) {
      log(
        "::warning::The checkout keeps the token in .git/config, where the test command can read it. Use actions/checkout with persist-credentials: false."
      );
    }
    try {
      junit = runTestsAtBaseAndHead({
        repoDir,
        base: pr.base.sha,
        head: pr.head.sha,
        command: input("test-command"),
        junit: input("junit") || "**/junit*.xml",
        coverage: input("coverage") || void 0,
        retries,
        workDir: env.RUNNER_TEMP ?? process.cwd(),
        log
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`::error::rsp could not run the tests at base and head: ${escapeData(msg)}`);
      return 1;
    }
  }
  let report;
  try {
    report = check({
      repoDir,
      base: pr.base.sha,
      head: pr.head.sha,
      rules: list("rules").length > 0 ? list("rules") : void 0,
      exclude: list("exclude"),
      ...junit
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof ConfigError) {
      log(`::error::rsp configuration is invalid: ${escapeData(msg)}`);
      return 1;
    }
    log(`::error::rsp could not read the pull request commits. Check out with fetch-depth: 0. ${escapeData(msg)}`);
    return 1;
  }
  const markdown = toMarkdown(report);
  const reportPath = join2(env.RUNNER_TEMP ?? process.cwd(), "rsp-report.json");
  writeFileSync(reportPath, toJson(report));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `findings=${report.findings.length}
report=${reportPath}
`);
  for (const f of report.findings) log(annotation(f));
  if (input("comment") !== "false") {
    const token = input("github-token");
    const repo = env.GITHUB_REPOSITORY ?? "";
    const api = env.GITHUB_API_URL ?? "https://api.github.com";
    try {
      await upsertComment(fetchImpl, api, token, repo, pr.number, `${COMMENT_MARKER}
${markdown}`, report.findings.length > 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`::warning::rsp could not write the pull request comment: ${escapeData(msg)}`);
    }
  }
  log(`rsp: ${report.findings.length} finding(s); report at ${reportPath}`);
  if (failOn === "any" && report.findings.length > 0) {
    log(`::error::rsp found ${report.findings.length} fact(s) and fail-on is "any"`);
    return 1;
  }
  return 0;
}
async function upsertComment(fetchImpl, api, token, repo, number, body, hasFindings) {
  const request = async (method, path, payload) => {
    const res = await fetchImpl(`${api}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...payload ? { "content-type": "application/json" } : {}
      },
      body: payload ? JSON.stringify(payload) : void 0
    });
    if (!res.ok) throw new Error(`${method} ${path} returned ${res.status}`);
    return res.json();
  };
  let existing;
  for (let page = 1; !existing; page++) {
    const comments = await request("GET", `/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`);
    existing = comments.find((c) => c.user?.type === "Bot" && c.body?.startsWith(COMMENT_MARKER));
    if (comments.length < 100) break;
  }
  if (existing) await request("PATCH", `/repos/${repo}/issues/comments/${existing.id}`, { body });
  else if (hasFindings) await request("POST", `/repos/${repo}/issues/${number}/comments`, { body });
}
function persistedCredentials(repoDir) {
  try {
    return execFileSync2("git", ["config", "--local", "--get-regexp", "^http\\..*\\.extraheader$"], {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() !== "";
  } catch {
    return false;
  }
}
function annotation(f) {
  const loc = f.locations[0];
  const props = [`title=${escapeProperty(`rsp ${f.ruleId}`)}`];
  if (loc) props.unshift(`file=${escapeProperty(loc.path)}`, ...loc.line ? [`line=${loc.line}`] : []);
  return `::warning ${props.join(",")}::${escapeData(f.message)}`;
}
function escapeData(s) {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function escapeProperty(s) {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}
function log(line) {
  process.stdout.write(`${line}
`);
}

// src/action-main.ts
runAction().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stdout.write(`::error::rsp failed: ${err instanceof Error ? err.message : String(err)}
`);
    process.exitCode = 1;
  }
);
/*! Bundled license information:

smol-toml/dist/error.js:
smol-toml/dist/primitive.js:
smol-toml/dist/date.js:
smol-toml/dist/extract.js:
smol-toml/dist/util.js:
smol-toml/dist/struct.js:
smol-toml/dist/parse.js:
smol-toml/dist/stringify.js:
smol-toml/dist/index.js:
  (*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   *)
*/
