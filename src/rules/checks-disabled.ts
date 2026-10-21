import type { FileChange, RawFinding, Rule } from "../types.js";

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

const PYTHON_TEST_FILE = /(^|\/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py)$/;

export const checksDisabled: Rule = {
  id: "checks/disabled",
  version: "0.1.0",
  description: "Checks that were removed or switched off: deleted test files, skip markers, lint and type suppressions.",
  run(ctx) {
    const findings: RawFinding[] = [];
    for (const file of ctx.files) {
      if (file.binary || !file.path.endsWith(".py")) continue;
      if (file.status === "deleted" && PYTHON_TEST_FILE.test(file.path)) {
        findings.push({
          message: "Test file deleted",
          locations: [{ path: file.path }],
          evidence: `deleted: ${file.path}`,
        });
        continue;
      }
      findings.push(...addedSuppressions(file));
    }
    return findings;
  },
};

/** Suppressions on added lines, ignoring lines that were only moved within the file. */
function addedSuppressions(file: FileChange): RawFinding[] {
  const removed = new Map<string, number>();
  for (const l of file.lines) {
    if (l.kind === "del") removed.set(l.text.trim(), (removed.get(l.text.trim()) ?? 0) + 1);
  }

  const findings: RawFinding[] = [];
  for (const l of file.lines) {
    if (l.kind !== "add") continue;
    const text = l.text.trim();
    const moved = removed.get(text) ?? 0;
    if (moved > 0) {
      removed.set(text, moved - 1);
      continue;
    }
    for (const p of PYTHON_PATTERNS) {
      if (p.regex.test(l.text)) {
        findings.push({
          message: `Added ${p.label}`,
          locations: [{ path: file.path, line: l.newLine }],
          evidence: text,
        });
      }
    }
  }
  return findings;
}
