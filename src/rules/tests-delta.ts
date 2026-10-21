import type { RawFinding, Rule } from "../types.js";
import { codeSpan } from "../text.js";

export const testsDelta: Rule = {
  id: "tests/delta",
  version: "0.1.0",
  keys: "the test id, `classname::name` as in the JUnit report, or `no-tests`",
  description:
    "Differences between the test results at base and at head, read from JUnit reports: tests that pass at base " +
    "and fail at head, tests that ran at base and are skipped or missing at head. Runs only when reports are given.",
  run(ctx) {
    if (!ctx.tests) return [];
    const { base, head } = ctx.tests;
    // Findings point at the head report: that is where a reader can look the test up.
    const where = head.files[0] ?? "junit";
    const finding = (key: string, message: string, evidence: string): RawFinding => ({
      key,
      message,
      locations: [{ path: where }],
      evidence,
    });

    if (head.results.size === 0 && base.results.size > 0) {
      return [finding("no-tests", `No test results at head; ${base.results.size} at base`, `tests: ${base.results.size} -> 0`)];
    }
    const findings: RawFinding[] = [];
    for (const [id, now] of head.results) {
      const before = base.results.get(id);
      if (before === "passed" && now === "failed") {
        findings.push(finding(id, `Test ${codeSpan(id)} fails at head and passed at base`, `${id}: passed -> failed`));
      } else if (before !== undefined && before !== "skipped" && now === "skipped") {
        findings.push(finding(id, `Test ${codeSpan(id)} is skipped at head and ran at base`, `${id}: ${before} -> skipped`));
      }
    }
    // Renamed or moved tests leave the total unchanged; only a smaller suite has lost tests.
    if (head.results.size < base.results.size) {
      for (const [id, before] of base.results) {
        if (head.results.has(id)) continue;
        findings.push(
          finding(
            id,
            `Test ${codeSpan(id)} ran at base and is missing at head (${base.results.size} tests at base, ${head.results.size} at head)`,
            `${id}: ${before} -> missing`,
          ),
        );
      }
    }
    return findings;
  },
};
