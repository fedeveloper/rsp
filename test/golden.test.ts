import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { check } from "../src/index.js";
import { makeFixtureRepo } from "./helpers.js";

interface Expected {
  ruleId: string;
  path: string;
  line?: number;
  message: string;
  evidence: string;
}

const FIXTURES = join(import.meta.dirname, "fixtures");

/**
 * Test reports a case carries in `reports/`: `junit-base*.xml`,
 * `junit-head*.xml` and coverage reports `coverage*`, in name order. Paths are relative to the working
 * directory, so that findings that point at a report are the same everywhere.
 */
function reports(caseDir: string): { junitBase?: string[]; junitHead?: string[]; coverage?: string[] } {
  const dir = join(caseDir, "reports");
  if (!existsSync(dir)) return {};
  const files = readdirSync(dir).sort();
  const pick = (prefix: string) => files.filter((f) => f.startsWith(prefix)).map((f) => relative(process.cwd(), join(dir, f)));
  return { junitBase: pick("junit-base"), junitHead: pick("junit-head"), coverage: pick("coverage") };
}

// Every case runs all rules, so a rule that fires on another rule's fixture fails too.
for (const group of readdirSync(FIXTURES).sort()) {
  describe(group, () => {
    for (const name of readdirSync(join(FIXTURES, group)).sort()) {
      it(name, () => {
        const caseDir = join(FIXTURES, group, name);
        const expected: Expected[] = JSON.parse(readFileSync(join(caseDir, "expected.json"), "utf8"));
        const repo = makeFixtureRepo(caseDir);
        try {
          const report = check({ repoDir: repo.dir, base: repo.base, head: repo.head, ...reports(caseDir) });
          const actual = report.findings.map((f) => ({
            ruleId: f.ruleId,
            path: f.locations[0]?.path,
            ...(f.locations[0]?.line !== undefined && { line: f.locations[0].line }),
            message: f.message,
            evidence: f.evidence,
          }));
          assert.deepEqual(actual, expected);
        } finally {
          repo.cleanup();
        }
      });
    }
  });
}
