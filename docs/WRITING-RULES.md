# Writing a rule

This guide is for anyone adding a rule to RSP or changing one. It covers what a rule is, the constraints every rule follows, and how a change is validated before it is merged. [CLAUDE.md](../CLAUDE.md) explains why RSP is built this way; this file explains how to work within it.

The running example is a small rule that reports `breakpoint()` and `pdb.set_trace()` calls added to Python code. Its full source is [docs/examples/breakpoint-rule.ts](examples/breakpoint-rule.ts), and [test/docs-example.test.ts](../test/docs-example.test.ts) runs it, so the example cannot drift from the code. It is not registered as a real rule.

## What a rule is

A rule is a pure function from a `DiffContext` to a list of raw findings (`src/types.ts`):

```ts
export const debugBreakpoint: Rule = {
  id: "debug/breakpoint",
  version: "0.1.0",
  keys: "`breakpoint` or `pdb`",
  knownKeys: ["breakpoint", "pdb"],
  description: "Python breakpoint() and pdb.set_trace() calls added by the diff.",
  run(ctx) {
    // ...
  },
};
```

- `id` is `area/what`. It is what users name in `.rsp.toml` and `--rule`, so it never changes once released.
- `version` is the rule's own version. Raise it whenever the findings on the same commits can change, and say so in [CHANGELOG.md](../CHANGELOG.md).
- `keys` describes the finding keys for `rsp --list-rules`. `knownKeys` lists them when they are a closed set, and then `allow` in `.rsp.toml` rejects anything else, so a typo cannot turn a check off.
- `run` returns `RawFinding`s: `key`, `message`, `locations` and `evidence`. The engine (`src/engine.ts`) adds the rule version, the fingerprint and the command that reproduces the finding, applies `allow` and `exclude`, and sorts.

The `DiffContext` (`src/context.ts`) gives a rule everything it may look at:

| Field | What it holds |
| --- | --- |
| `files` | Changed files with their added and deleted lines, line numbers on both sides, status (`added`, `modified`, `deleted`, `renamed`) and `oldPath` for renames. Files hidden by `exclude` are already gone. |
| `readBase(path)`, `readHead(path)` | The full text of any file at either commit, or `undefined` when it does not exist there. |
| `listHead()` | Every path tracked at head, sorted. Use it to find manifests and example files. |
| `tests` | Test results at base and head, only when JUnit reports were given. |

A rule must not read the file system, the network, the clock or the environment. Two runs on the same commits must give the same bytes.

Register a new rule in `src/rules/index.ts`. Put language helpers in the existing `python*.ts` and `js*.ts` files rather than in the rule, so other rules can share them.

## The constraints, applied

The example shows each of the principles in CLAUDE.md in a few lines.

**Diff-scoped.** Look only at `add` lines of files that still exist. A `breakpoint()` that was already there is not reported:

```ts
if (file.binary || file.status === "deleted" || !file.path.endsWith(".py")) continue;
for (const line of file.lines) {
  if (line.kind !== "add") continue;
```

If a pattern can move from one file to another (a function moved to a new module), compare with the deleted lines of the whole diff and treat a line that was only moved as not new. `checks/disabled` and `env/missing-example` show how.

**Precision before recall.** When the rule cannot be sure, it says nothing. The usual traps, each of which produced a false fact at some point in RSP's history:

- the pattern inside a string, a docstring or a template literal (`stringLines` in `python.ts`, `nonCodeLines` and `blankStrings` in `js.ts`);
- the pattern inside a comment;
- code guarded so that it does not always run (`if TYPE_CHECKING:`, `try`/`except ImportError`, `try`/`catch`);
- test files and helper files in test folders, where the rules of the game differ (`@ts-expect-error` is an assertion there);
- lines moved between files;
- a configuration replaced by an equivalent one (eslint by oxlint), which is not a removal;
- manifests or lists computed at run time, which the rule cannot read completely.

Recall can always be improved later. A false fact makes readers stop trusting every other finding.

**Facts, not judgements.** The message says what changed, in the past tense, and nothing about whether it is good: "Added `pdb.set_trace()` call", never "Remove the debugger call". Messages starting with `Added`, `Imports`, `Reads` or `Parameters` are checked independently by the real-history probe; a new kind of message needs its own check there (see below).

**Untrusted text.** Everything that comes from the diff (names, code, paths) goes through `codeSpan` (`src/text.ts`) when it appears in a message. The Markdown report escapes the rest, but only `codeSpan` keeps a name with backticks from breaking out of its span.

**Evidence and location.** `evidence` is the trimmed text of the reported line, exactly as it is in the file at head, and `locations[0]` points at it. The real-history probe checks that the line at that location holds the evidence. The fingerprint is built from the rule, the path and the evidence, not the line number, so keep evidence stable across unrelated edits.

**Keys.** The key is what a team writes under `allow` to accept a kind of finding: a pattern id, a package, a variable, a function name. Pick something a reader can type from the report without looking anything up.

## Validating a change

Passing the tests proves the rules are consistent with themselves. It does not prove they work on real code. A rule change goes through four layers, in this order.

### 1. Golden fixtures

Add a case under `test/fixtures/<rule>/<case>/` for every new behaviour, positive and negative:

```
test/fixtures/checks-disabled/skip-marker-added/
  base/            tree at the base commit
  head/            tree at the head commit
  reports/         optional: junit-base*.xml and junit-head*.xml for tests/delta
  expected.json    the findings, written by hand before running the rule
```

`expected.json` lists `ruleId`, `path`, `line`, `message` and `evidence` of every finding, in report order, or `[]`. Write it before you run the rule: an expectation copied from the output only proves the rule does what it does.

Every case runs every rule (`test/golden.test.ts`), so a new rule that fires on another rule's fixture fails too. Read those failures carefully: they are often the first false facts.

```sh
npm test
```

### 2. Labelled mutations

`eval/mutations.ts` (Python) and `eval/mutations-js.ts` (TypeScript) apply risky and benign changes to the sample projects in `eval/project/` and `eval/project-js/`. A risky mutation names the rules that must report it; a benign one must produce no findings at all. Add both kinds for the behaviour you changed, especially the benign changes that look like the risky one.

```sh
npm run eval
```

The results files (`eval/RESULTS.md`, `eval/RESULTS_JS.md`) are committed, and CI fails if they change without being regenerated.

### 3. Real history

`eval/real-history.ts` runs every rule on recent commits of public projects and checks each line-level finding against git independently of the rules.

```sh
git clone --depth 400 https://github.com/pallets/flask
node --import tsx eval/real-history.ts --commits 100 --out /tmp/history.md flask
```

Read every finding in the report. Anything marked `WRONG LINE`, `NOT NEW`, `NOT A DEFINITION` or `SAME AT BASE`, and anything that is technically true but not what the message claims, is a false fact: fix it and turn it into a golden fixture. A rule with a new kind of fact also needs a new independent check in `verify()`, written against git rather than reusing the rule's own code. The committed reports (`eval/REAL_HISTORY.md`, `eval/REAL_HISTORY_JS.md`) list the projects and commits used.

This is the layer where almost every false fact so far was found.

### 4. Action tests

If the change affects the Action (new inputs, new report sections), extend `test/action.test.ts`, which runs the Action against a fake GitHub API, and the end-to-end job in `.github/workflows/ci.yml`, which runs it from `action.yml` on a real runner.

### SWE-bench

When a rule changes, rerun `eval/swe-bench.ts` and read the new findings. It is a measurement, not a gate, but it has found false facts the other layers missed.

## Before opening the pull request

- [ ] The rule version is raised, or the rule is new and registered in `src/rules/index.ts`.
- [ ] New keys are in `knownKeys` when the set is closed.
- [ ] Messages quote diff text with `codeSpan`.
- [ ] Golden fixtures for every new behaviour, positive and negative, written by hand.
- [ ] Mutations added and `npm run eval` regenerated.
- [ ] Real history run and every finding read.
- [ ] README: the rule's section and Limitations.
- [ ] CHANGELOG: an entry under Unreleased.
- [ ] `npm run typecheck`, `npm test` and `npm run bundle`, with `action-dist/` committed.
