import assert from "node:assert/strict";
import { it } from "node:test";
import { debugBreakpoint } from "../docs/examples/breakpoint-rule.js";
import { buildContext } from "../src/context.js";
import { runRules } from "../src/engine.js";
import { makeRepoFromTrees } from "./helpers.js";

// The example rule in docs/WRITING-RULES.md, run as the guide describes.
it("runs the example rule of the rule-writing guide", () => {
  const before = 'def total(items):\n    breakpoint()  # already there\n    return sum(items)\n';
  const after =
    'def total(items):\n    breakpoint()  # already there\n    import pdb; pdb.set_trace()\n    return sum(items)\n\n\nHELP = """\nCall breakpoint() to debug.\n"""\n';
  const repo = makeRepoFromTrees(new Map([["app.py", before]]), new Map([["app.py", after]]));
  try {
    const report = runRules(buildContext(repo.dir, repo.base, repo.head), [debugBreakpoint]);
    assert.deepEqual(
      report.findings.map((f) => [f.key, f.message, f.locations[0], f.evidence]),
      [["pdb", "Added `pdb.set_trace()` call", { path: "app.py", line: 3 }, "import pdb; pdb.set_trace()"]],
    );
  } finally {
    repo.cleanup();
  }
});
