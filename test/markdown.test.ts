import assert from "node:assert/strict";
import { it } from "node:test";
import { toMarkdown } from "../src/index.js";
import { codeSpan } from "../src/text.js";
import type { Finding, Report } from "../src/types.js";

function report(finding: Partial<Finding>): Report {
  return {
    base: "a".repeat(40),
    head: "b".repeat(40),
    config: null,
    options: [],
    rules: [{ id: "tests/delta", version: "0.1.0" }],
    tool: { name: "rsp", version: "0.0.0" },
    findings: [
      {
        ruleId: "tests/delta",
        ruleVersion: "0.1.0",
        key: "k",
        message: "m",
        locations: [{ path: "junit.xml" }],
        evidence: "e",
        fingerprint: "f",
        reproduce: "r",
        ...finding,
      },
    ],
  };
}

it("quotes any text in a code span that it cannot end", () => {
  assert.equal(codeSpan("plain"), "`plain`");
  assert.equal(codeSpan("a`b"), "``a`b``");
  assert.equal(codeSpan("``x"), "``` ``x ```");
  assert.equal(codeSpan("two\nlines"), "`two lines`");
});

it("renders text from the diff without links, HTML, mentions or broken tables", () => {
  const id = "t::x` <img src=https://evil.test/p.png> [win](https://evil.test) @octocat | `";
  const md = toMarkdown(
    report({
      message: `Test ${codeSpan(id)} fails at head and passed at base`,
      evidence: "x = `` `cmd` `` | <script>",
      locations: [{ path: "a|b<c>.xml", line: 3 }],
    }),
  );
  const row = md.split("\n").find((l) => l.startsWith("| tests/delta"))!;
  // Every pipe that is not a cell border is escaped, so the row has exactly five borders.
  assert.equal(row.replace(/\\\|/g, "").split("|").length - 1, 5, row);
  // Outside code spans nothing is left that GitHub would render as HTML, a link or a mention.
  const outside = row.replace(/(`+)[^`][\s\S]*?\1/g, "");
  assert.doesNotMatch(outside, /<|\]\(|@octocat/, outside);
});
