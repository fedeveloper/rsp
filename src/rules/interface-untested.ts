import type { DiffContext, RawFinding, Rule } from "../types.js";
import { JS_FILE } from "./js.js";
import { describeChange, describeFields, jsSignatures, pythonSignatures, type Signature } from "./signatures.js";
import { codeSpan } from "../text.js";

const PYTHON_TEST_FILE = /(^|\/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py)$/;
const JS_TEST_FILE = /(^|\/)(__tests__|tests?|e2e|spec)\/.*\.[cm]?[jt]sx?$|\.(test|spec|test-d)\.[cm]?[jt]sx?$/;
const PYTHON_TEST_DIR = /(^|\/)tests?\//;

export const interfaceUntested: Rule = {
  id: "interface/untested-change",
  version: "0.2.0",
  keys: "the function or type name, e.g. `load_settings`, `Store.add` or `Settings`",
  description:
    "Public functions whose parameters changed (added, removed, reordered, new defaults, or renamed where " +
    "callers pass them by name), and exported TypeScript object types whose fields were removed, added as " +
    "required or made required, while no test file changed by the diff mentions them. Only in repositories " +
    "that have tests.",
  run(ctx) {
    const head = ctx.listHead();
    // A repository without tests has no convention of updating them.
    if (!head.some(isTestFile)) return [];
    const changedTests = ctx.files
      .filter((f) => f.status !== "deleted" && !f.binary && isTestFile(f.path))
      .map((f) => ctx.readHead(f.path) ?? "");

    const findings: RawFinding[] = [];
    for (const file of ctx.files) {
      if (file.binary || file.status === "added" || file.status === "deleted") continue;
      if (isTestFile(file.path) || PYTHON_TEST_DIR.test(file.path)) continue;
      const extract = signatureReader(file.path);
      if (!extract) continue;
      const id = (s: Signature) => `${s.fields ? "type" : "function"}:${s.name}`;
      const before = new Map(extract(ctx.readBase(file.oldPath) ?? "").map((s) => [id(s), s]));
      const touched = new Set(file.lines.filter((l) => l.kind === "add").map((l) => l.newLine));
      for (const sig of extract(ctx.readHead(file.path) ?? "")) {
        const old = before.get(id(sig));
        if (!old || !touchesDefinition(ctx, file.path, sig, touched)) continue;
        // Adding or removing an annotation is no change for callers; changing it is.
        const returned = !sig.fields && old.returns && sig.returns && old.returns !== sig.returns;
        if (old.shape === sig.shape && !returned) continue;
        const changes: string[] = [];
        if (old.shape !== sig.shape) {
          const change = sig.fields
            ? describeFields(old.params, sig.params, !!(old.extends || sig.extends))
            : describeChange(old.params, sig.params, !file.path.endsWith(".py"));
          if (change !== undefined) changes.push(change);
        }
        if (returned) changes.push(`${changes.length ? "return type " : ""}changed ${codeSpan(old.returns!)} to ${codeSpan(sig.returns!)}`);
        if (changes.length === 0) continue;
        // Tests call a constructor by its class name.
        const parts = sig.name.split(".");
        const bare = parts.length > 1 && (parts[1] === "__init__" || parts[1] === "constructor") ? parts[0]! : parts[parts.length - 1]!;
        const word = new RegExp(`\\b${bare.replace(/\$/g, "\\$")}\\b`);
        if (changedTests.some((t) => word.test(t))) continue;
        findings.push({
          key: sig.name,
          message: `${sig.fields ? "Fields" : old.shape === sig.shape ? "Return type" : "Parameters"} of ${codeSpan(sig.name)}: ${changes.join("; ")}; no test changed by the diff mentions it`,
          locations: [{ path: file.path, line: sig.line }],
          evidence: (ctx.readHead(file.path) ?? "").split("\n")[sig.line - 1]!.trim(),
        });
      }
    }
    return findings;
  },
};

function signatureReader(path: string): ((text: string) => Signature[]) | undefined {
  if (path.endsWith(".py")) return pythonSignatures;
  if (JS_FILE.test(path) && !/\.(vue|svelte)$/.test(path)) return jsSignatures;
  return undefined;
}

function isTestFile(path: string): boolean {
  return PYTHON_TEST_FILE.test(path) || JS_TEST_FILE.test(path);
}

/** True when an added line falls within the definition's parameter list. */
function touchesDefinition(ctx: DiffContext, path: string, sig: Signature, touched: Set<number | undefined>): boolean {
  if (sig.span) {
    for (let n = sig.span[0]; n <= sig.span[1]; n++) if (touched.has(n)) return true;
    return false;
  }
  const lines = (ctx.readHead(path) ?? "").split("\n");
  for (let n = sig.line; n <= Math.min(lines.length, sig.line + 50); n++) {
    if (touched.has(n)) return true;
    if (/\)\s*(->[^:]*)?:\s*(#.*)?$|\)\s*(:[^=]*)?(=>|\{)/.test(lines[n - 1]!)) return false;
  }
  return false;
}
