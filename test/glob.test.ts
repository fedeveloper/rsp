import assert from "node:assert/strict";
import { it } from "node:test";
import { globToRegExp } from "../src/glob.js";

it("matches globs against repository paths", () => {
  const cases: [string, string, boolean][] = [
    ["tests/fixtures/**", "tests/fixtures/a/b.py", true],
    ["tests/fixtures/**", "tests/fixture.py", false],
    ["**/conftest.py", "conftest.py", true],
    ["**/conftest.py", "a/b/conftest.py", true],
    ["src/*.py", "src/app.py", true],
    ["src/*.py", "src/pkg/app.py", false],
    ["docs/?.md", "docs/a.md", true],
    ["a.b", "axb", false],
  ];
  for (const [glob, path, expected] of cases) {
    assert.equal(globToRegExp(glob).test(path), expected, `${glob} vs ${path}`);
  }
});
