import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";
import { VERSION } from "../src/version.js";
import { makeFixtureRepo } from "./helpers.js";

const ROOT = join(import.meta.dirname, "..");

function rsp(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", join(ROOT, "src/cli.ts"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

it("keeps VERSION in sync with package.json", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(VERSION, pkg.version);
});

it("prints a markdown report and exits 0 even with findings", () => {
  const repo = makeFixtureRepo(join(ROOT, "test/fixtures/checks-disabled/skip-marker-added"));
  try {
    const res = rsp(["check", "--repo", repo.dir, "--base", repo.base, "--head", repo.head]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /^### rsp · 1 fact on [0-9a-f]{12}\.\.[0-9a-f]{12}/);
    assert.match(res.stdout, /\| checks\/disabled \| `tests\/test_auth.py:6` \| Added pytest skip marker \|/);
  } finally {
    repo.cleanup();
  }
});

it("prints JSON with --format json", () => {
  const repo = makeFixtureRepo(join(ROOT, "test/fixtures/checks-disabled/non-python-ignored"));
  try {
    const res = rsp(["check", "--repo", repo.dir, "--base", repo.base, "--format", "json"]);
    assert.equal(res.status, 0, res.stderr);
    const report = JSON.parse(res.stdout);
    assert.equal(report.head, repo.head);
    assert.deepEqual(report.findings, []);
  } finally {
    repo.cleanup();
  }
});

it("exits 2 on usage errors and unknown rules", () => {
  assert.equal(rsp(["check"]).status, 2);
  const res = rsp(["check", "--base", "HEAD", "--rule", "nope"]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Unknown rule: nope/);
});
