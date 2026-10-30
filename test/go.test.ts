import assert from "node:assert/strict";
import { it } from "node:test";
import { blankGoStrings, goEnvReads, goImports, goNonCodeLines, goSumEntries, isGoStdlib, parseGoMod } from "../src/rules/go.js";

it("reads Go imports in every form, and none inside comments or raw strings", () => {
  const src = [
    "package main", // 1
    "",
    'import "fmt"', // 3
    'import y "gopkg.in/yaml.v3"', // 4
    "/*", // 5
    'import "not/real"',
    "*/",
    "import (", // 8
    '\t_ "embed"',
    '\t. "github.com/a/b" // dot import',
    "\t`raw`",
    ")",
    "func main() {}",
    'import "after/decl"',
  ].join("\n");
  assert.deepEqual(goImports(src), [
    { path: "fmt", line: 3 },
    { path: "gopkg.in/yaml.v3", line: 4 },
    { path: "embed", line: 9 },
    { path: "github.com/a/b", line: 10 },
  ]);
  assert.deepEqual([...goNonCodeLines(src)], [6]);
});

it("knows the standard library, environment reads and strings", () => {
  assert.equal(isGoStdlib("net/http"), true);
  assert.equal(isGoStdlib("C"), true);
  assert.equal(isGoStdlib("github.com/a/b"), false);
  assert.deepEqual(goEnvReads('a := os.Getenv("A"); _, ok := os.LookupEnv("B"); os.Setenv("C", "x")'), ["A", "B"]);
  assert.equal(blankGoStrings('x := "//nolint" + `t.Skip(` // nolint'), 'x := "" + `` // nolint');
});

it("parses go.mod blocks, single lines, replaces and go.sum", () => {
  const mod = parseGoMod(
    'module example.com/m\n\ngo 1.22\n\nrequire github.com/a/b v1.0.0\nrequire (\n\tgolang.org/x/text v0.14.0 // indirect\n)\nreplace github.com/c/d => ../d\nreplace github.com/e/f v1.0.0 => github.com/g/f v1.1.0\n',
    "go.mod",
  )!;
  assert.equal(mod.module, "example.com/m");
  assert.deepEqual([...mod.require], [["github.com/a/b", "v1.0.0"], ["golang.org/x/text", "v0.14.0"]]);
  assert.deepEqual([...mod.lines], [["github.com/a/b", 5], ["golang.org/x/text", 7]]);
  assert.deepEqual([...mod.replace], [["github.com/c/d", { local: true }], ["github.com/e/f", { local: false }]]);
  assert.equal(parseGoMod("go 1.22\n", "go.mod"), undefined);
  assert.deepEqual([...goSumEntries("a v1 h1:x=\na v1/go.mod h1:y=\n")], ["a v1"]);
});
