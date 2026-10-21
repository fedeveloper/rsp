import assert from "node:assert/strict";
import { it } from "node:test";
import { parseUnifiedDiff } from "../src/diff.js";

it("tracks line numbers of added and removed lines", () => {
  const files = parseUnifiedDiff(
    [
      "diff --git a/app.py b/app.py",
      "index 1111111..2222222 100644",
      "--- a/app.py",
      "+++ b/app.py",
      "@@ -2 +2,2 @@ def f():",
      "-    return 1",
      "+    x = 1",
      "+    return x",
      "@@ -10,0 +12 @@",
      "+# end",
      "\\ No newline at end of file",
    ].join("\n"),
  );
  assert.equal(files.length, 1);
  assert.deepEqual(files[0], {
    path: "app.py",
    oldPath: "app.py",
    status: "modified",
    binary: false,
    lines: [
      { kind: "del", text: "    return 1", oldLine: 2 },
      { kind: "add", text: "    x = 1", newLine: 2 },
      { kind: "add", text: "    return x", newLine: 3 },
      { kind: "add", text: "# end", newLine: 12 },
    ],
  });
});

it("counts context lines when the diff has context", () => {
  const [file] = parseUnifiedDiff(
    ["diff --git a/a.py b/a.py", "--- a/a.py", "+++ b/a.py", "@@ -1,3 +1,3 @@", " a", "-b", "+B", " c"].join("\n"),
  );
  assert.deepEqual(file?.lines, [
    { kind: "del", text: "b", oldLine: 2 },
    { kind: "add", text: "B", newLine: 2 },
  ]);
});

it("recognises added, deleted, renamed and binary files", () => {
  const files = parseUnifiedDiff(
    [
      "diff --git a/new.py b/new.py",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.py",
      "@@ -0,0 +1 @@",
      "+print()",
      "diff --git a/tests/test_old.py b/tests/test_old.py",
      "deleted file mode 100644",
      "--- a/tests/test_old.py",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-def test(): pass",
      "diff --git a/src/a.py b/lib/a.py",
      "similarity index 100%",
      "rename from src/a.py",
      "rename to lib/a.py",
      "diff --git a/logo.png b/logo.png",
      "Binary files a/logo.png and b/logo.png differ",
    ].join("\n"),
  );
  assert.deepEqual(
    files.map((f) => [f.status, f.oldPath, f.path, f.binary]),
    [
      ["added", "new.py", "new.py", false],
      ["deleted", "tests/test_old.py", "tests/test_old.py", false],
      ["renamed", "src/a.py", "lib/a.py", false],
      ["modified", "logo.png", "logo.png", true],
    ],
  );
});

it("handles paths with spaces and quoted paths", () => {
  const files = parseUnifiedDiff(
    [
      "diff --git a/my dir/x.py b/my dir/x.py",
      "similarity index 100%",
      "diff --git \"a/tab\\there.py\" \"b/tab\\there.py\"",
      "--- \"a/tab\\there.py\"",
      "+++ \"b/tab\\there.py\"",
    ].join("\n"),
  );
  assert.deepEqual(
    files.map((f) => f.path),
    ["my dir/x.py", "tab\there.py"],
  );
});
