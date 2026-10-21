import type { DiffContext, FileChange, RawFinding, Rule } from "../types.js";

interface Pattern {
  label: string;
  regex: RegExp;
}

// Python only for now; other ecosystems get their own pattern lists.
const PYTHON_PATTERNS: Pattern[] = [
  { label: "pytest skip marker", regex: /@pytest\.mark\.skip(if)?\b/ },
  { label: "pytest xfail marker", regex: /@pytest\.mark\.xfail\b/ },
  { label: "pytest.skip() call", regex: /\bpytest\.skip\s*\(/ },
  { label: "unittest skip decorator", regex: /@unittest\.(skip|skipIf|skipUnless|expectedFailure)\b/ },
  { label: "noqa comment", regex: /#\s*noqa\b/i },
  { label: "type: ignore comment", regex: /#\s*type:\s*ignore\b/ },
  { label: "pylint disable comment", regex: /#\s*pylint:\s*disable\b/ },
  { label: "coverage exclusion", regex: /#\s*pragma:\s*no\s*cover\b/ },
  { label: "bandit nosec comment", regex: /#\s*nosec\b/ },
];

const WORKFLOW_PATTERNS: Pattern[] = [
  { label: "continue-on-error: true", regex: /^\s*continue-on-error:\s*true\b/ },
  { label: "`|| true` after a command", regex: /\|\|\s*true\b/ },
  { label: "step or job disabled with `if: false`", regex: /^\s*-?\s*if:\s*(false|\$\{\{\s*false\s*\}\})\s*$/ },
];

const TEST_CONFIG_PATTERNS: Pattern[] = [
  { label: "pytest option that excludes tests", regex: /--deselect\b|--ignore(-glob)?\b|(^|\s)-p\s+no:/ },
];

// Commands whose removal from CI switches off a check.
const CHECK_COMMAND = /\b(pytest|tox|nox|ruff|flake8|mypy|pyright|pylint|black|isort|bandit|coverage|unittest)\b/;
const CHECK_COMMAND_ALL = new RegExp(CHECK_COMMAND.source, "g");
const COVERAGE_THRESHOLD = /(?:fail_under|fail-under|--cov-fail-under)\s*[=:]?\s*["']?(\d+(?:\.\d+)?)/;
const ASSERTION = /^\s*assert\b|\bself\.assert[A-Z]\w*\(|\bpytest\.raises\(/;

const PYTHON_TEST_FILE = /(^|\/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py)$/;
const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const TEST_CONFIG_FILE = /(^|\/)(pyproject\.toml|setup\.cfg|pytest\.ini|tox\.ini|\.coveragerc)$/;

export const checksDisabled: Rule = {
  id: "checks/disabled",
  version: "0.2.0",
  description:
    "Checks that were removed or switched off: deleted test files, fewer assertions, skip markers, " +
    "lint and type suppressions, CI steps removed or allowed to fail, lower coverage thresholds.",
  run(ctx) {
    const findings: RawFinding[] = [];
    // Python lines moved between files are not new suppressions.
    const removedPython = multiset(ctx.files.filter((f) => f.path.endsWith(".py") || f.oldPath.endsWith(".py")), "del");
    for (const file of ctx.files) {
      if (file.binary) continue;
      if (file.path.endsWith(".py")) findings.push(...pythonFile(file, removedPython));
      if (WORKFLOW_FILE.test(file.path)) findings.push(...workflowFile(file));
      if (TEST_CONFIG_FILE.test(file.path)) findings.push(...testConfigFile(ctx, file));
    }
    findings.push(...fewerAssertions(ctx));
    return findings;
  },
};

function pythonFile(file: FileChange, removed: Map<string, number>): RawFinding[] {
  if (file.status === "deleted") {
    return PYTHON_TEST_FILE.test(file.path)
      ? [{ message: "Test file deleted", locations: [{ path: file.path }], evidence: `deleted: ${file.path}` }]
      : [];
  }
  return matchAdded(file, PYTHON_PATTERNS, removed);
}

/**
 * Test files whose assertion count dropped, reported only when the diff as a
 * whole has fewer assertions: tests moved to another file are not a loss.
 */
function fewerAssertions(ctx: DiffContext): RawFinding[] {
  const tests = ctx.files.filter(
    (f) => !f.binary && (PYTHON_TEST_FILE.test(f.path) || PYTHON_TEST_FILE.test(f.oldPath)),
  );
  const counts = tests.map((f) => ({
    file: f,
    before: f.status === "added" ? 0 : countAssertions(ctx.readBase(f.oldPath)),
    after: f.status === "deleted" ? 0 : countAssertions(ctx.readHead(f.path)),
  }));
  const total = (k: "before" | "after") => counts.reduce((n, c) => n + c[k], 0);
  if (total("after") >= total("before")) return [];
  return counts
    .filter((c) => c.file.status !== "added" && c.file.status !== "deleted" && c.after < c.before)
    .map((c) => ({
      message: `Assertions in test file went from ${c.before} to ${c.after}`,
      locations: [{ path: c.file.path }],
      evidence: `assertions: ${c.before} -> ${c.after}`,
    }));
}

function workflowFile(file: FileChange): RawFinding[] {
  const findings = matchAdded(file, WORKFLOW_PATTERNS);
  // A command still present on some added line was edited, not removed; the
  // added line is judged by WORKFLOW_PATTERNS instead.
  const addedCommands = new Set(
    file.lines.filter((l) => l.kind === "add").flatMap((l) => l.text.match(CHECK_COMMAND_ALL) ?? []),
  );
  for (const l of file.lines) {
    if (l.kind !== "del") continue;
    const command = CHECK_COMMAND.exec(l.text)?.[1];
    if (!command || addedCommands.has(command)) continue;
    const what = file.status === "deleted" ? "Workflow running a check deleted" : "Removed CI line running a check";
    findings.push({
      // Removed lines exist only in base, so the line number is given as a base line.
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
      message: `Coverage threshold went from ${before} to ${after ?? "none"}`,
      locations: [{ path: file.path, line: line?.newLine }],
      evidence: line?.text.trim() ?? `coverage threshold: ${before} -> none`,
    });
  }
  return findings;
}

/**
 * Pattern matches on added lines, ignoring lines that were only moved: present
 * among `removed` (this file's removed lines unless given).
 */
function matchAdded(file: FileChange, patterns: Pattern[], removed = multiset([file], "del")): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const l of file.lines) {
    if (l.kind !== "add" || take(removed, l.text.trim())) continue;
    for (const p of patterns) {
      if (p.regex.test(l.text)) {
        findings.push({
          message: `Added ${p.label}`,
          locations: [{ path: file.path, line: l.newLine }],
          evidence: l.text.trim(),
        });
      }
    }
  }
  return findings;
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

function countAssertions(text: string | undefined): number {
  return (text ?? "").split("\n").filter((l) => ASSERTION.test(l)).length;
}

function threshold(text: string | undefined): number | undefined {
  const m = COVERAGE_THRESHOLD.exec(text ?? "");
  return m ? Number(m[1]) : undefined;
}
