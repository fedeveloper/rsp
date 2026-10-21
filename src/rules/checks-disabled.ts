import type { DiffContext, DiffLine, FileChange, RawFinding, Rule } from "../types.js";
import { blankStrings, JS_FILE, nonCodeLines } from "./js.js";

interface Pattern {
  /** What a project lists under `allow` in .rsp.toml to accept these findings. */
  id: string;
  label: string;
  regex: RegExp;
}

const PYTHON_PATTERNS: Pattern[] = [
  { id: "pytest-skip", label: "pytest skip marker", regex: /@pytest\.mark\.skip(if)?\b/ },
  { id: "pytest-xfail", label: "pytest xfail marker", regex: /@pytest\.mark\.xfail\b/ },
  { id: "pytest-skip-call", label: "pytest.skip() call", regex: /\bpytest\.skip\s*\(/ },
  { id: "unittest-skip", label: "unittest skip decorator", regex: /@unittest\.(skip|skipIf|skipUnless|expectedFailure)\b/ },
  { id: "noqa", label: "noqa comment", regex: /#\s*noqa\b/i },
  { id: "type-ignore", label: "type: ignore comment", regex: /#\s*type:\s*ignore\b/ },
  { id: "pylint-disable", label: "pylint disable comment", regex: /#\s*pylint:\s*disable\b/ },
  { id: "coverage-exclusion", label: "coverage exclusion", regex: /#\s*pragma:\s*no\s*cover\b/ },
  { id: "nosec", label: "bandit nosec comment", regex: /#\s*nosec\b/ },
];

const JS_PATTERNS: Pattern[] = [
  { id: "eslint-disable", label: "eslint-disable comment", regex: /(\/\/|\/\*)\s*(eslint|oxlint)-disable\b/ },
  { id: "ts-ignore", label: "@ts-ignore comment", regex: /(\/\/|\/\*)\s*@ts-ignore\b/ },
  { id: "ts-nocheck", label: "@ts-nocheck comment", regex: /(\/\/|\/\*)\s*@ts-nocheck\b/ },
  { id: "ts-expect-error", label: "@ts-expect-error comment", regex: /(\/\/|\/\*)\s*@ts-expect-error\b/ },
  { id: "biome-ignore", label: "biome-ignore comment", regex: /(\/\/|\/\*)\s*biome-ignore\b/ },
  { id: "coverage-exclusion", label: "coverage exclusion", regex: /(\/\/|\/\*)\s*(istanbul|c8|v8)\s+ignore\b/ },
];

// Only in test files, where `it.skip(` cannot be anything else.
const JS_TEST_PATTERNS: Pattern[] = [
  { id: "test-skip", label: "skipped test (`.skip`)", regex: /(^|[^\w.$])(describe|it|test|context|suite)\.(skip|skipIf|fixme)\b/ },
  { id: "test-only", label: "focused test (`.only`), which skips the others", regex: /(^|[^\w.$])(describe|it|test|context|suite)\.only\b/ },
  { id: "test-skip", label: "skipped test (`x` prefix)", regex: /(^|[^\w.$])x(describe|it|test|context)\s*\(/ },
];

const WORKFLOW_PATTERNS: Pattern[] = [
  { id: "continue-on-error", label: "continue-on-error: true", regex: /^\s*continue-on-error:\s*true\b/ },
  { id: "or-true", label: "`|| true` after a command", regex: /\|\|\s*true\b/ },
  { id: "or-exit-0", label: "`|| exit 0` after a command", regex: /\|\|\s*exit\s+0\b/ },
  { id: "if-false", label: "step or job disabled with `if: false`", regex: /^\s*-?\s*if:\s*(false|\$\{\{\s*false\s*\}\})\s*$/ },
];

const TEST_CONFIG_PATTERNS: Pattern[] = [
  { id: "pytest-exclude-option", label: "pytest option that excludes tests", regex: /--deselect\b|--ignore(-glob)?\b|(^|\s)-p\s+no:/ },
];

const PACKAGE_JSON_PATTERNS: Pattern[] = [
  { id: "or-true", label: "`|| true` after a command", regex: /\|\|\s*true\b/ },
  { id: "or-exit-0", label: "`|| exit 0` after a command", regex: /\|\|\s*exit\s+0\b/ },
];

const TSCONFIG_PATTERNS: Pattern[] = [
  {
    id: "ts-strict-off",
    label: "TypeScript check turned off",
    regex: /"(strict|noImplicitAny|strictNullChecks|strictFunctionTypes|strictBindCallApply|noImplicitThis|alwaysStrict|noImplicitReturns|noUnusedLocals|noUnusedParameters|noUncheckedIndexedAccess|noFallthroughCasesInSwitch)"\s*:\s*false\b/,
  },
];

const ESLINT_CONFIG_PATTERNS: Pattern[] = [
  { id: "eslint-rule-off", label: "ESLint rule turned off", regex: /['"]?[\w@/-]+['"]?\s*:\s*\[?\s*(['"]off['"]|0\s*[,\]}]|0\s*$)/ },
];

// Checks of the same kind replace one another: moving from eslint to oxlint
// or from jest to vitest does not switch a check off.
const CHECK_KIND: Record<string, string> = {
  pytest: "test", unittest: "test", tox: "test", nox: "test", jest: "test", vitest: "test", mocha: "test",
  ava: "test", playwright: "test", cypress: "test", "test script": "test",
  ruff: "lint", flake8: "lint", pylint: "lint", eslint: "lint", oxlint: "lint", biome: "lint",
  "lint script": "lint",
  mypy: "types", pyright: "types", tsc: "types", "typecheck script": "types", "type-check script": "types",
  black: "format", isort: "format", prettier: "format",
};

// Commands whose removal from CI or package.json scripts switches off a check.
const CHECK_COMMAND = new RegExp(
  "\\b(pytest|tox|nox|ruff|flake8|mypy|pyright|pylint|black|isort|bandit|coverage|unittest" +
    "|jest|vitest|mocha|ava|eslint|oxlint|tsc|prettier|playwright|cypress|biome)\\b" +
    "|\\b(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?(test|lint|typecheck|type-check|check)\\b",
);
const CHECK_COMMAND_ALL = new RegExp(CHECK_COMMAND.source, "g");
const COVERAGE_THRESHOLD = /(?:fail_under|fail-under|--cov-fail-under)\s*[=:]?\s*["']?(\d+(?:\.\d+)?)/;
const PYTHON_ASSERTION = /^\s*assert\b|\bself\.assert[A-Z]\w*\(|\bpytest\.raises\(/;
const JS_ASSERTION = /\bexpect\(|(^|[^\w.$])assert(\.\w+)?\(|\bt\.(is|not|deepEqual|true|false|throws|equal|ok)\(/;

const PYTHON_TEST_FILE = /(^|\/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py)$/;
const JS_TEST_NAME = /\.(test|spec|e2e|test-d|tst)\.[cm]?[jt]sx?$/;
const JS_TEST_DIR = /(^|\/)(__tests__|tests?|e2e|cypress|spec)\/.*\.[cm]?[jt]sx?$/;
const JS_TEST_CALL = /(^|[^\w.$])(describe|it|test)\s*\(/;
const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const TEST_CONFIG_FILE = /(^|\/)(pyproject\.toml|setup\.cfg|pytest\.ini|tox\.ini|\.coveragerc)$/;
const TSCONFIG_FILE = /(^|\/)[jt]sconfig[\w.-]*\.json$/;
const ESLINT_CONFIG_FILE = /(^|\/)(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.(json|js|cjs|yml|yaml))?)$/;

const KNOWN_KEYS = [
  ...new Set([
    ...[PYTHON_PATTERNS, JS_PATTERNS, JS_TEST_PATTERNS, WORKFLOW_PATTERNS, TEST_CONFIG_PATTERNS].flat().map((p) => p.id),
    ...[PACKAGE_JSON_PATTERNS, TSCONFIG_PATTERNS, ESLINT_CONFIG_PATTERNS].flat().map((p) => p.id),
    "test-file-deleted", "fewer-assertions", "ci-check-removed", "coverage-threshold-lowered", "script-check-removed",
  ]),
].sort();

export const checksDisabled: Rule = {
  id: "checks/disabled",
  version: "0.3.0",
  keys: "a pattern id, e.g. `type-ignore` or `eslint-disable`",
  knownKeys: KNOWN_KEYS,
  description:
    "Checks that were removed or switched off: deleted test files, fewer assertions, skip markers, " +
    "lint and type suppressions, CI steps or package.json scripts removed or allowed to fail, " +
    "lower coverage thresholds, TypeScript and ESLint checks turned off.",
  run(ctx) {
    const findings: RawFinding[] = [];
    // Source lines moved between files are not new suppressions.
    const removedSource = multiset(ctx.files.filter((f) => isSource(f.path) || isSource(f.oldPath)), "del");
    for (const file of ctx.files) {
      if (file.binary) continue;
      if (file.path.endsWith(".py")) findings.push(...pythonFile(file, removedSource));
      if (JS_FILE.test(file.path)) findings.push(...jsFile(ctx, file, removedSource));
      if (WORKFLOW_FILE.test(file.path)) findings.push(...workflowFile(file));
      if (TEST_CONFIG_FILE.test(file.path)) findings.push(...testConfigFile(ctx, file));
      if (file.path.split("/").pop() === "package.json") findings.push(...packageJsonFile(ctx, file));
      if (TSCONFIG_FILE.test(file.path)) findings.push(...matchAdded(file, TSCONFIG_PATTERNS));
      if (ESLINT_CONFIG_FILE.test(file.path)) findings.push(...matchAdded(file, ESLINT_CONFIG_PATTERNS));
    }
    findings.push(...fewerAssertions(ctx));
    return findings;
  },
};

function pythonFile(file: FileChange, removed: Map<string, number>): RawFinding[] {
  if (file.status === "deleted") {
    return PYTHON_TEST_FILE.test(file.path)
      ? [{ key: "test-file-deleted", message: "Test file deleted", locations: [{ path: file.path }], evidence: `deleted: ${file.path}` }]
      : [];
  }
  return matchAdded(file, PYTHON_PATTERNS, removed);
}

function jsFile(ctx: DiffContext, file: FileChange, removed: Map<string, number>): RawFinding[] {
  if (file.status === "deleted") {
    return isJsTestFile(file.path, ctx.readBase(file.path))
      ? [{ key: "test-file-deleted", message: "Test file deleted", locations: [{ path: file.path }], evidence: `deleted: ${file.path}` }]
      : [];
  }
  const inTests = JS_TEST_NAME.test(file.path) || JS_TEST_DIR.test(file.path);
  // In type tests `@ts-expect-error` is the assertion, not a suppression.
  const patterns = inTests
    ? [...JS_PATTERNS.filter((p) => p.id !== "ts-expect-error"), ...JS_TEST_PATTERNS]
    : JS_PATTERNS;
  // Suppressions inside strings or template literals are text, not directives.
  const nonCode = nonCodeLines(ctx.readHead(file.path) ?? "");
  return matchAdded(file, patterns, removed, (l) => (nonCode.has(l.newLine!) ? "" : blankStrings(l.text)));
}

/**
 * Scripts that ran a check at base and no longer do at head, unless the same
 * check is still run by another script of the same package.json.
 */
function packageJsonFile(ctx: DiffContext, file: FileChange): RawFinding[] {
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
      now === undefined
        ? {
            key: "script-check-removed",
            message: `Removed package.json script \`${name}\`, which ran ${lost.map((c) => `\`${c}\``).join(", ")}`,
            locations: [{ path: file.path }],
            evidence: `"${name}": ${JSON.stringify(command)}`,
          }
        : {
            key: "script-check-removed",
            message: `package.json script \`${name}\` no longer runs ${lost.map((c) => `\`${c}\``).join(", ")}`,
            locations: [{ path: file.path, line: index >= 0 ? index + 1 : undefined }],
            evidence: index >= 0 ? lines[index]!.trim() : `"${name}": ${JSON.stringify(now)}`,
          },
    );
  }
  return findings;
}

function scripts(text: string | undefined): Record<string, string> | undefined {
  try {
    const json = JSON.parse(text ?? "") as { scripts?: Record<string, unknown> };
    return Object.fromEntries(Object.entries(json.scripts ?? {}).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return undefined;
  }
}

/**
 * Test files whose assertion count dropped, reported only when the diff as a
 * whole has fewer assertions: tests moved to another file are not a loss.
 */
function fewerAssertions(ctx: DiffContext): RawFinding[] {
  const tests = ctx.files.filter(
    (f) => !f.binary && (isTestFile(f.path, ctx.readHead(f.path)) || isTestFile(f.oldPath, ctx.readBase(f.oldPath))),
  );
  const counts = tests.map((f) => ({
    file: f,
    before: f.status === "added" ? 0 : countAssertions(f.oldPath, ctx.readBase(f.oldPath)),
    after: f.status === "deleted" ? 0 : countAssertions(f.path, ctx.readHead(f.path)),
  }));
  const total = (k: "before" | "after") => counts.reduce((n, c) => n + c[k], 0);
  if (total("after") >= total("before")) return [];
  return counts
    .filter((c) => c.file.status !== "added" && c.file.status !== "deleted" && c.after < c.before)
    .map((c) => ({
      key: "fewer-assertions",
      message: `Assertions in test file went from ${c.before} to ${c.after}`,
      locations: [{ path: c.file.path }],
      evidence: `assertions: ${c.before} -> ${c.after}`,
    }));
}

function workflowFile(file: FileChange): RawFinding[] {
  const findings = matchAdded(file, WORKFLOW_PATTERNS);
  // A check of the same kind still run on some added line was edited or replaced,
  // not removed; the added line is judged by WORKFLOW_PATTERNS instead.
  const addedKinds = new Set(
    file.lines.filter((l) => l.kind === "add").flatMap((l) => checkCommands(l.text).map(kind)),
  );
  for (const l of file.lines) {
    if (l.kind !== "del") continue;
    const command = isShellLine(l.text) ? checkCommands(l.text)[0] : undefined;
    if (!command || addedKinds.has(kind(command))) continue;
    const what = file.status === "deleted" ? "Workflow running a check deleted" : "Removed CI line running a check";
    findings.push({
      // Removed lines exist only in base, so the line number is given as a base line.
      key: "ci-check-removed",
      message: `${what} (base line ${l.oldLine})`,
      locations: [{ path: file.oldPath }],
      evidence: l.text.trim(),
    });
  }
  return findings;
}

function testConfigFile(ctx: DiffContext, file: FileChange): RawFinding[] {
  const findings = matchAdded(file, TEST_CONFIG_PATTERNS);
  const before = threshold(ctx.readBase(file.oldPath));
  const after = threshold(ctx.readHead(file.path));
  if (before !== undefined && (after === undefined || after < before)) {
    const line = file.lines.find((l) => l.kind === "add" && COVERAGE_THRESHOLD.test(l.text));
    findings.push({
      key: "coverage-threshold-lowered",
      message: `Coverage threshold went from ${before} to ${after ?? "none"}`,
      locations: [{ path: file.path, line: line?.newLine }],
      evidence: line?.text.trim() ?? `coverage threshold: ${before} -> none`,
    });
  }
  return findings;
}

/**
 * Pattern matches on added lines, ignoring lines that were only moved: present
 * among `removed` (this file's removed lines unless given). `code` gives the
 * part of a line the patterns are tested on.
 */
function matchAdded(
  file: FileChange,
  patterns: Pattern[],
  removed = multiset([file], "del"),
  code: (l: DiffLine) => string = (l) => l.text,
): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const l of file.lines) {
    if (l.kind !== "add" || take(removed, l.text.trim())) continue;
    for (const p of patterns) {
      if (p.regex.test(code(l))) {
        findings.push({
          key: p.id,
          message: `Added ${p.label}`,
          locations: [{ path: file.path, line: l.newLine }],
          evidence: l.text.trim(),
        });
      }
    }
  }
  return findings;
}

/**
 * A `run:` line or a line of a multi-line `run: |` block. YAML keys and flow
 * mappings (a matrix entry such as `- {python: '3.13', tox: py313}`) are not.
 */
function isShellLine(line: string): boolean {
  if (/^\s*(-\s*)?run:/.test(line)) return true;
  return !/^\s*(-\s*)?([\w-]+\s*:|[{[])/.test(line);
}

/**
 * Check commands a line runs. Package manager scripts are named by the script
 * alone, so switching between `npm test` and `pnpm run test` is no change.
 */
function checkCommands(line: string): string[] {
  return [...line.matchAll(CHECK_COMMAND_ALL)].map((m) => m[1] ?? `${m[2]} script`);
}

function isSource(path: string): boolean {
  return path.endsWith(".py") || JS_FILE.test(path);
}

function kind(command: string): string {
  return CHECK_KIND[command] ?? command;
}

function isTestFile(path: string, text: string | undefined): boolean {
  return PYTHON_TEST_FILE.test(path) || isJsTestFile(path, text);
}

/** Named as a test, or in a test folder and calling describe/it/test (not a helper). */
function isJsTestFile(path: string, text: string | undefined): boolean {
  return JS_TEST_NAME.test(path) || (JS_TEST_DIR.test(path) && JS_TEST_CALL.test(text ?? ""));
}

function multiset(files: FileChange[], kind: "add" | "del"): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of files) {
    for (const l of f.lines) if (l.kind === kind) m.set(l.text.trim(), (m.get(l.text.trim()) ?? 0) + 1);
  }
  return m;
}

/** Removes one occurrence of `text`; true when there was one. */
function take(m: Map<string, number>, text: string): boolean {
  const n = m.get(text) ?? 0;
  if (n > 0) m.set(text, n - 1);
  return n > 0;
}

function countAssertions(path: string, text: string | undefined): number {
  const assertion = path.endsWith(".py") ? PYTHON_ASSERTION : JS_ASSERTION;
  return (text ?? "").split("\n").filter((l) => assertion.test(l)).length;
}

function threshold(text: string | undefined): number | undefined {
  const m = COVERAGE_THRESHOLD.exec(text ?? "");
  return m ? Number(m[1]) : undefined;
}
