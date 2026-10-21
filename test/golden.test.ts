import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

// Every case runs all rules, so a rule that fires on another rule's fixture fails too.
for (const group of readdirSync(FIXTURES).sort()) {
  describe(group, () => {
    for (const name of readdirSync(join(FIXTURES, group)).sort()) {
      it(name, () => {
        const caseDir = join(FIXTURES, group, name);
        const expected: Expected[] = JSON.parse(readFileSync(join(caseDir, "expected.json"), "utf8"));
        const repo = makeFixtureRepo(caseDir);
        try {
          const report = check({ repoDir: repo.dir, base: repo.base, head: repo.head });
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
