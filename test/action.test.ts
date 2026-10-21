import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { COMMENT_MARKER, runAction } from "../src/action.js";
import { type FixtureRepo, makeFixtureRepo, makeRepoFromTrees } from "./helpers.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

interface Call {
  method: string;
  url: string;
  body?: { body: string };
}

/** Fake GitHub API: serves `comments` on the list call and records every request. */
function fakeApi(comments: { id: number; body: string }[], failWrites = false) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method !== "GET" && failWrites) return new Response("{}", { status: 403 });
    return new Response(JSON.stringify(method === "GET" ? comments : {}), { status: 200 });
  };
  return { calls, fetchImpl };
}

function setup(fixture: string | FixtureRepo, inputs: Record<string, string> = {}) {
  const repo = typeof fixture === "string" ? makeFixtureRepo(join(FIXTURES, fixture)) : fixture;
  const tmp = mkdtempSync(join(tmpdir(), "rsp-action-"));
  const eventPath = join(tmp, "event.json");
  writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 7, base: { sha: repo.base }, head: { sha: repo.head } } }));
  writeFileSync(join(tmp, "summary.md"), "");
  writeFileSync(join(tmp, "output.txt"), "");
  const env: Record<string, string> = {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_WORKSPACE: repo.dir,
    GITHUB_REPOSITORY: "acme/shop",
    GITHUB_API_URL: "https://api.test",
    GITHUB_STEP_SUMMARY: join(tmp, "summary.md"),
    GITHUB_OUTPUT: join(tmp, "output.txt"),
    RUNNER_TEMP: tmp,
    "INPUT_GITHUB-TOKEN": "t0ken",
  };
  for (const [k, v] of Object.entries(inputs)) env[`INPUT_${k.toUpperCase()}`] = v;
  const read = (name: string) => readFileSync(join(tmp, name), "utf8");
  const cleanup = () => {
    repo.cleanup();
    rmSync(tmp, { recursive: true, force: true });
  };
  return { env, read, cleanup };
}

it("creates the comment, summary and outputs when there are findings", async () => {
  const s = setup("checks-disabled/skip-marker-added");
  try {
    const api = fakeApi([]);
    assert.equal(await runAction(s.env, api.fetchImpl), 0);
    assert.deepEqual(
      api.calls.map((c) => `${c.method} ${c.url}`),
      ["GET https://api.test/repos/acme/shop/issues/7/comments?per_page=100&page=1", "POST https://api.test/repos/acme/shop/issues/7/comments"],
    );
    const body = api.calls[1]!.body!.body;
    assert.ok(body.startsWith(COMMENT_MARKER));
    assert.match(body, /Added pytest skip marker/);
    assert.match(s.read("summary.md"), /### rsp · 1 fact/);
    assert.match(s.read("output.txt"), /^findings=1\nreport=.*rsp-report\.json\n$/);
    assert.equal(JSON.parse(s.read("rsp-report.json")).findings.length, 1);
  } finally {
    s.cleanup();
  }
});

it("updates its existing comment instead of adding another", async () => {
  const s = setup("checks-disabled/skip-marker-added");
  try {
    const api = fakeApi([{ id: 1, body: "unrelated" }, { id: 42, body: `${COMMENT_MARKER}\nold report` }]);
    assert.equal(await runAction(s.env, api.fetchImpl), 0);
    assert.equal(api.calls[1]!.method, "PATCH");
    assert.equal(api.calls[1]!.url, "https://api.test/repos/acme/shop/issues/comments/42");
  } finally {
    s.cleanup();
  }
});

it("posts nothing when there are no findings and no earlier comment", async () => {
  const s = setup("checks-disabled/non-python-ignored");
  try {
    const api = fakeApi([]);
    assert.equal(await runAction(s.env, api.fetchImpl), 0);
    assert.deepEqual(api.calls.map((c) => c.method), ["GET"]);
    assert.match(s.read("output.txt"), /^findings=0\n/);
  } finally {
    s.cleanup();
  }
});

it("clears an earlier comment once the findings are gone", async () => {
  const s = setup("checks-disabled/non-python-ignored");
  try {
    const api = fakeApi([{ id: 42, body: `${COMMENT_MARKER}\nold report` }]);
    assert.equal(await runAction(s.env, api.fetchImpl), 0);
    assert.equal(api.calls[1]!.method, "PATCH");
    assert.match(api.calls[1]!.body!.body, /None of the 3 rules found facts in this diff/);
  } finally {
    s.cleanup();
  }
});

it("fails the step with fail-on: any", async () => {
  const s = setup("checks-disabled/skip-marker-added", { "fail-on": "any", comment: "false" });
  try {
    const api = fakeApi([]);
    assert.equal(await runAction(s.env, api.fetchImpl), 1);
    assert.equal(api.calls.length, 0);
  } finally {
    s.cleanup();
  }
});

it("still succeeds when the token cannot write comments", async () => {
  const s = setup("checks-disabled/skip-marker-added");
  try {
    const api = fakeApi([], true);
    assert.equal(await runAction(s.env, api.fetchImpl), 0);
    assert.match(s.read("summary.md"), /Added pytest skip marker/);
  } finally {
    s.cleanup();
  }
});

it("honours exclude globs and records them in the reproduce command", async () => {
  const s = setup("checks-disabled/skip-marker-added", { exclude: "tests/**\nother/*.py", comment: "false" });
  try {
    assert.equal(await runAction(s.env, fakeApi([]).fetchImpl), 0);
    const report = JSON.parse(s.read("rsp-report.json"));
    assert.deepEqual(report.findings, []);
    assert.deepEqual(report.options, ["--exclude 'other/*.py'", "--exclude 'tests/**'"]);
  } finally {
    s.cleanup();
  }
});

it("rejects an unknown fail-on value", async () => {
  const s = setup("checks-disabled/skip-marker-added", { "fail-on": "warning" });
  try {
    assert.equal(await runAction(s.env, fakeApi([]).fetchImpl), 1);
  } finally {
    s.cleanup();
  }
});

it("runs from the committed bundle", async () => {
  const { spawnSync } = await import("node:child_process");
  const s = setup("checks-disabled/skip-marker-added", { comment: "false" });
  try {
    const res = spawnSync(process.execPath, [join(import.meta.dirname, "..", "action-dist", "index.js")], {
      env: { ...s.env, PATH: process.env.PATH },
      encoding: "utf8",
    });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /::warning file=tests\/test_auth.py,line=6,title=rsp checks\/disabled::Added pytest skip marker/);
    assert.match(s.read("output.txt"), /^findings=1\n/);
  } finally {
    s.cleanup();
  }
});

it("fails with a clear error when .rsp.toml is invalid", async () => {
  const tree = new Map([[".rsp.toml", '[rules."checks/disable"]\n'], ["app.py", "x = 1\n"]]);
  const s = setup(makeRepoFromTrees(tree, new Map([...tree, ["app.py", "x = 2\n"]])));
  const logs: string[] = [];
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string) => logs.push(chunk) > 0) as typeof process.stdout.write;
  try {
    assert.equal(await runAction(s.env, fakeApi([]).fetchImpl), 1);
  } finally {
    process.stdout.write = write;
    s.cleanup();
  }
  assert.ok(logs.some((l) => /::error::rsp configuration is invalid: \.rsp\.toml: unknown rule "checks\/disable"/.test(l)), logs.join(""));
});
