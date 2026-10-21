import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { check } from "../src/index.js";
import { mergeRuns, parseJUnit } from "../src/junit.js";
import { makeFixtureRepo } from "./helpers.js";

// As written by pytest --junitxml.
const PYTEST = `<?xml version="1.0" encoding="utf-8"?>
<testsuites><testsuite name="pytest" errors="0" failures="1" skipped="1" tests="4">
<testcase classname="tests.test_store" name="test_add" time="0.001" />
<testcase classname="tests.test_store" name="test_remove" time="0.002"><failure message="assert 1 == 2">E assert 1 == 2</failure></testcase>
<testcase classname="tests.test_store" name="test_slow" time="0"><skipped type="pytest.skip" message="slow">skipped</skipped></testcase>
<testcase classname="tests.test_api" name="test_get[a&amp;b]" time="0.1"><error message="boom"><![CDATA[<failure> in output]]></error></testcase>
</testsuite></testsuites>`;

// As written by jest-junit and vitest --reporter=junit.
const JEST = `<testsuites name="jest tests">
  <testsuite name="api" tests="2">
    <testcase classname="api fetches users" name="api fetches users" time="0.01">
    </testcase>
    <testcase classname='api retries' name='api retries' time='0.02'>
      <failure>Error: expected 2</failure>
    </testcase>
    <!-- <testcase classname="commented" name="out" /> -->
  </testsuite>
</testsuites>`;

it("reads pytest, jest and vitest reports", () => {
  assert.deepEqual(
    [...parseJUnit(PYTEST)],
    [
      ["tests.test_store::test_add", "passed"],
      ["tests.test_store::test_remove", "failed"],
      ["tests.test_store::test_slow", "skipped"],
      ["tests.test_api::test_get[a&b]", "failed"],
    ],
  );
  assert.deepEqual(
    [...parseJUnit(JEST)],
    [
      ["api fetches users::api fetches users", "passed"],
      ["api retries::api retries", "failed"],
    ],
  );
});

it("counts a test that passed in any rerun as passed", () => {
  const fail = '<testcase classname="a" name="t"><failure/></testcase>';
  const pass = '<testcase classname="a" name="t"/>';
  assert.equal(mergeRuns([{ path: "1", xml: fail }, { path: "2", xml: pass }]).results.get("a::t"), "passed");
  assert.equal(mergeRuns([{ path: "1", xml: fail }, { path: "2", xml: fail }]).results.get("a::t"), "failed");
});

function report(cases: Record<string, "pass" | "fail" | "skip">): string {
  const body = Object.entries(cases)
    .map(([name, s]) => {
      const inner = s === "fail" ? "<failure/>" : s === "skip" ? "<skipped/>" : "";
      return `<testcase classname="tests" name="${name}">${inner}</testcase>`;
    })
    .join("\n");
  return `<testsuite>${body}</testsuite>`;
}

function run(base: string, head: string) {
  const repo = makeFixtureRepo(join(import.meta.dirname, "fixtures", "checks-disabled", "non-python-ignored"));
  const tmp = mkdtempSync(join(tmpdir(), "rsp-junit-"));
  try {
    writeFileSync(join(tmp, "base.xml"), base);
    writeFileSync(join(tmp, "head.xml"), head);
    return check({
      repoDir: repo.dir,
      base: repo.base,
      head: repo.head,
      junitBase: [join(tmp, "base.xml")],
      junitHead: [join(tmp, "head.xml")],
    });
  } finally {
    repo.cleanup();
    rmSync(tmp, { recursive: true, force: true });
  }
}

it("reports new failures and skips, but not failures already present at base", () => {
  const r = run(
    report({ a: "pass", b: "pass", c: "fail", d: "pass", e: "skip" }),
    report({ a: "pass", b: "fail", c: "fail", d: "skip", e: "skip", f: "fail" }),
  );
  assert.deepEqual(
    r.findings.map((f) => [f.key, f.message]),
    [
      ["tests::b", "Test `tests::b` fails at head and passed at base"],
      ["tests::d", "Test `tests::d` is skipped at head and ran at base"],
    ],
  );
  assert.ok(r.findings[0]!.reproduce.includes("--junit-base"));
  assert.ok(r.findings[0]!.reproduce.includes("--junit-head"));
});

it("reports missing tests only when the suite got smaller", () => {
  const renamed = run(report({ a: "pass", b: "pass" }), report({ a: "pass", b2: "pass" }));
  assert.deepEqual(renamed.findings, []);
  const removed = run(report({ a: "pass", b: "pass", c: "pass" }), report({ a: "pass" }));
  assert.deepEqual(
    removed.findings.map((f) => f.message),
    [
      "Test `tests::b` ran at base and is missing at head (3 tests at base, 1 at head)",
      "Test `tests::c` ran at base and is missing at head (3 tests at base, 1 at head)",
    ],
  );
  const none = run(report({ a: "pass" }), "<testsuites/>");
  assert.deepEqual(none.findings.map((f) => f.message), ["No test results at head; 1 at base"]);
});

it("needs reports for both commits", () => {
  const repo = makeFixtureRepo(join(import.meta.dirname, "fixtures", "checks-disabled", "non-python-ignored"));
  try {
    assert.throws(
      () => check({ repoDir: repo.dir, base: repo.base, head: repo.head, junitHead: ["x.xml"] }),
      /both base and head/,
    );
  } finally {
    repo.cleanup();
  }
});
