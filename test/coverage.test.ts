import assert from "node:assert/strict";
import { it } from "node:test";
import { coverageByRepoPath, parseCoverage } from "../src/coverage.js";

it("reads LCOV and Cobertura, and nothing else", () => {
  const lcov = parseCoverage("TN:\nSF:src/a.ts\nDA:1,3\nDA:2,0\nend_of_record\n")!;
  assert.deepEqual([...lcov.get("src/a.ts")!], [[1, 3], [2, 0]]);
  const cob = parseCoverage('<coverage><sources><source>/w</source></sources><class filename="pkg/m.py"><lines><line number="4" hits="0"/></lines></class></coverage>')!;
  assert.deepEqual([...cob.get("/w/pkg/m.py")!], [[4, 0]]);
  assert.equal(parseCoverage("<testsuites/>"), undefined);
});

it("uses a Cobertura file name as it is when there are several sources", () => {
  const cob = parseCoverage('<coverage><sources><source>/a</source><source>/b</source></sources><class filename="m.py"><lines><line number="1" hits="1"/></lines></class></coverage>')!;
  assert.deepEqual([...cob.keys()], ["m.py"]);
});

it("matches report paths to the tracked file with the longest suffix, and merges reports", () => {
  const files = ["a.ts", "src/a.ts", "src/b.ts"];
  const one = parseCoverage("SF:/ci/repo/src/a.ts\nDA:1,0\nDA:2,0\nend_of_record\nSF:C:\\ci\\repo\\src\\b.ts\nDA:1,1\nend_of_record\nSF:/ci/other.ts\nDA:1,1\nend_of_record\n")!;
  const two = parseCoverage("SF:src/a.ts\nDA:1,2\nend_of_record\n")!;
  const merged = coverageByRepoPath([one, two], files);
  assert.deepEqual([...merged.keys()].sort(), ["src/a.ts", "src/b.ts"]);
  assert.deepEqual([...merged.get("src/a.ts")!], [[1, 2], [2, 0]]);
});
