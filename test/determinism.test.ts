import assert from "node:assert/strict";
import { join } from "node:path";
import { it } from "node:test";
import { check, toJson, toMarkdown } from "../src/index.js";
import { makeFixtureRepo } from "./helpers.js";

const CASE = join(import.meta.dirname, "fixtures", "checks-disabled", "skip-variants");

it("produces byte-identical output for the same commits", () => {
  const a = makeFixtureRepo(CASE);
  const b = makeFixtureRepo(CASE);
  try {
    assert.equal(a.head, b.head, "fixture commits should have stable SHAs");
    const first = check({ repoDir: a.dir, base: a.base, head: a.head });
    const second = check({ repoDir: b.dir, base: b.base, head: b.head });
    assert.equal(toJson(first), toJson(second));
    assert.equal(toMarkdown(first), toMarkdown(second));
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

it("gives every finding a distinct fingerprint and a reproduce command", () => {
  const repo = makeFixtureRepo(CASE);
  try {
    const report = check({ repoDir: repo.dir, base: repo.base, head: repo.head });
    const fingerprints = report.findings.map((f) => f.fingerprint);
    assert.equal(new Set(fingerprints).size, fingerprints.length);
    for (const f of report.findings) {
      assert.equal(f.reproduce, `npx rsp check --base ${repo.base} --head ${repo.head} --rule ${f.ruleId}`);
    }
  } finally {
    repo.cleanup();
  }
});
