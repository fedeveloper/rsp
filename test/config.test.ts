import assert from "node:assert/strict";
import { join } from "node:path";
import { it } from "node:test";
import { ConfigError, parseConfig } from "../src/config.js";
import { check, toMarkdown } from "../src/index.js";
import { ALL_RULES } from "../src/rules/index.js";
import { makeFixtureRepo } from "./helpers.js";

const CASE = join(import.meta.dirname, "fixtures", "config", "allow-exclude-and-disable");

it("parses a full configuration", () => {
  const config = parseConfig(
    'exclude = ["b/**", "a/**"]\n[rules."checks/disabled"]\nallow = ["noqa"]\nexclude = ["x/**"]\n' +
      '[rules."env/missing-example"]\nenabled = false\n',
    ALL_RULES,
  );
  assert.deepEqual(config, {
    path: ".rsp.toml",
    exclude: ["a/**", "b/**"],
    rules: {
      "checks/disabled": { enabled: true, exclude: ["x/**"], allow: ["noqa"] },
      "env/missing-example": { enabled: false, exclude: [], allow: [] },
    },
  });
});

it("rejects typos instead of ignoring them", () => {
  const cases: [string, RegExp][] = [
    ['[rules."checks/disable"]\n', /unknown rule "checks\/disable"/],
    ['[rules."checks/disabled"]\nalow = ["noqa"]\n', /unknown key "rules\."checks\/disabled"\.alow"/],
    ['[rules."checks/disabled"]\nallow = ["type_ignore"]\n', /unknown "type_ignore"; known: .*type-ignore/],
    ['excludes = ["a"]\n', /unknown key "excludes"/],
    ['exclude = "a/**"\n', /exclude must be a list of strings/],
    ['[rules."deps/undeclared"]\nenabled = "no"\n', /enabled must be true or false/],
    ["rules = [", /\.rsp\.toml: /],
  ];
  for (const [text, message] of cases) {
    assert.throws(() => parseConfig(text, ALL_RULES), (err: unknown) => err instanceof ConfigError && message.test(err.message));
  }
});

it("records the configuration in the report, and --no-config ignores it", () => {
  const repo = makeFixtureRepo(CASE);
  try {
    const configured = check({ repoDir: repo.dir, base: repo.base, head: repo.head });
    assert.equal(configured.config, ".rsp.toml");
    assert.deepEqual(configured.rules.map((r) => r.id), ["checks/disabled", "deps/undeclared", "interface/untested-change"]);
    assert.match(toMarkdown(configured), /Configuration: `\.rsp\.toml` from the base commit\./);

    const plain = check({ repoDir: repo.dir, base: repo.base, head: repo.head, config: false });
    assert.equal(plain.config, null);
    assert.deepEqual(plain.options, ["--no-config"]);
    assert.ok(plain.findings.length > configured.findings.length);
    assert.ok(plain.findings.every((f) => f.reproduce.includes("--no-config")));
  } finally {
    repo.cleanup();
  }
});

it("runs a disabled rule when it is named explicitly", () => {
  const repo = makeFixtureRepo(CASE);
  try {
    const report = check({ repoDir: repo.dir, base: repo.base, head: repo.head, rules: ["env/missing-example"] });
    assert.deepEqual(report.findings.map((f) => f.key), ["AWS_REGION"]);
  } finally {
    repo.cleanup();
  }
});
