# rsp

Context for anyone, human or AI, picking up work on this repository. The README says what rsp does and how to use it; this file records why it is built this way and how changes are expected to be made.

## What rsp is and is not

rsp is a rule-based verifier for code changes, aimed at plausible but wrong changes such as those written by coding assistants. It reads the diff of a pull request, runs bounded checks and reports only reproducible facts: rule, file and line, evidence, and the command that reproduces the finding.

It is not an AI reviewer and it never judges whether a change is correct. A finding says what changed, never whether it is bad. Whether a finding blocks a merge is configuration, and the default is advisory (`fail-on: never`).

The name is **RSP: Reproducible Shortcut Patrol** (chosen 2026-10-21). The command, the package and the config file keep the lower-case `rsp`; the Marketplace listing, the README title and the report header use "RSP".

## Decisions

- Language: TypeScript on Node >= 22, ESM. The only runtime dependency is `smol-toml`. Tests use `node:test` with `tsx`.
- Ecosystems: Python first, then JavaScript/TypeScript (v0.2).
- Delivery: a JavaScript GitHub Action (`action.yml`, Node 24, bundled into `action-dist/`) and a CLI (`rsp check`), both thin wrappers around the same pure core.
- Configuration: `.rsp.toml` (TOML, because `smol-toml` is already the one dependency), read from the base commit so a pull request cannot relax its own checks. Unknown keys, rules and pattern ids are errors. Each finding has a `key` that `allow` matches.
- Test delta: rsp never runs tests itself in the core. `tests/delta` compares JUnit XML reports of base and head; the Action can run a `test-command` at both commits in git worktrees and rerun head to clear flaky failures.
- License: Apache-2.0.
- Releases are git tags `vX.Y.Z` on `main`, pushed by the maintainer. The version lives in `package.json` and `src/version.ts`, and a test keeps them in sync with `CHANGELOG.md`, whose section becomes the release notes. `.github/workflows/release.yml` creates the release and moves the major tag `v0`.
- The maintainer writes in Italian. Code, comments, commits and docs in the repository are in English.

## Principles that constrain every change

- **Facts, not judgements.** Messages state what changed ("Added `@ts-ignore` comment"), never advice.
- **Precision before recall.** When a case is ambiguous, the rule stays silent. A false fact costs more trust than a missed one.
- **Diff-scoped.** Rules look only at added or changed lines, so pre-existing debt is never reported. Lines moved between files are not new.
- **Reproducible.** Same commits and rsp version give byte-identical output. Rules use no network and no clock. Findings are sorted and carry a fingerprint that does not depend on line numbers.

## Security rules

- Text from the diff is untrusted. Rules quote names and code with `codeSpan` (`src/text.ts`), the Markdown report escapes everything outside code spans, and log lines escape workflow commands. A new message that interpolates diff text must go through `codeSpan`.
- RSP executes repository code only through `test-command`, and then without `INPUT_*`, `ACTIONS_*` or step files in the environment, with workflow commands stopped, and never on `pull_request_target`.
- Workflows pin actions by commit SHA, set `permissions: {}` at the top and grant per job, and check out with `persist-credentials: false`.

## Code layout

- `src/engine.ts`, `src/context.ts`, `src/git.ts`, `src/diff.ts`: the core, from two commits to a `DiffContext`, then to sorted findings.
- `src/rules/`: one file per rule, each a pure function over `DiffContext`. Language helpers are in `python*.ts` and `js*.ts`.
- `src/report/`: JSON and Markdown output. `src/action.ts`: the GitHub Action (sticky PR comment, job summary, annotations).
- `test/fixtures/<rule>/<case>/`: golden cases, each with `base/`, `head/` and a hand-written `expected.json`.
- `eval/`: evaluation corpora and reports (see below).
- `docs/WRITING-RULES.md`: how to write and validate a rule, with an example rule that `test/docs-example.test.ts` runs.
- `CHANGELOG.md`: every release, with rule versions and fixed false facts. Add an entry under Unreleased with each change.

## How a rule change is validated

Passing our own tests proves consistency, not that a rule works on real code. Every rule change goes through all four layers:

1. **Golden fixtures.** Add a case per new behaviour (with JUnit reports in `reports/` when the rule reads test results), positive and negative, with expectations written by hand before running the rule. Every case runs every rule, so a rule that fires on another rule's fixture fails too.
2. **Labelled mutations** (`npm run eval`). Risky and benign changes applied to the sample Python project (`eval/mutations.ts`) and the sample TypeScript service (`eval/mutations-js.ts`); the results file is committed and CI fails if it changes. Corpora built on real applications whose code must not be copied into this public repository live outside it and run with `RSP_EVAL_EXTRA=<file>[:<file>...]`; never commit their mutations, results or names. `tests/delta` is covered by fixtures and Action tests instead, because it needs test runs.
3. **Real history** (`eval/real-history.ts`). Run the rules on about 100 recent commits of several public projects and check each finding against git independently of the rules. Every false fact found there gets fixed and becomes a golden fixture. This layer is where all false facts so far were found: aliased `TYPE_CHECKING`, optional imports, CI matrix keys, imports inside template literals, helper files in test folders, eslint replaced by oxlint, pnpm lockfiles written as several YAML documents, Yarn Berry keys quoted as a whole.
4. **Action tests** against a fake GitHub API, including a run from the committed bundle, and the `e2e` CI job that runs the Action from `action.yml` on RSP's own pull requests.

On top of these, `eval/swe-bench.ts` runs the rules on SWE-bench Lite: the human fix of each task and the patches of three agent submissions. It is a measurement, not a gate; rerun it when a rule changes and read the new findings. Its first run found more false facts: skip markers and imports inside Python strings, `setup.py` lists built in variables or imported from other modules, `pytest` in test files of projects that declare it outside manifests, methods defined twice, and a backslash-newline that shifted line numbers in the string scanners.

After changing `src/`, run `npm run bundle` and commit `action-dist/`, because CI checks that it is up to date.

## Ideas not started

- Per-rule blocking: `fail-on` per rule or per key in `.rsp.toml`, instead of only `never` and `any`.
- Interface changes beyond parameters: return annotations, removed public functions and classes.
- More ecosystems (Go, Rust), each with its own manifests and suppressions.
- Test delta without JUnit: read pytest and Vitest JSON reports directly.
- Run `tests/delta` in the SWE-bench evaluation, using the task's test commands in the official Docker images.
