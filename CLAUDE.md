# rsp

Context for anyone, human or AI, picking up work on this repository. The README says what rsp does and how to use it; this file records why it is built this way and how changes are expected to be made.

## What rsp is and is not

rsp is a rule-based verifier for code changes, aimed at plausible but wrong changes such as those written by coding assistants. It reads the diff of a pull request, runs bounded checks and reports only reproducible facts: rule, file and line, evidence, and the command that reproduces the finding.

It is not an AI reviewer and it never judges whether a change is correct. A finding says what changed, never whether it is bad. Whether a finding blocks a merge is configuration, and the default is advisory (`fail-on: never`).

The name is not settled yet. The working expansion is "Reproducible Signals for Pull requests".

## Decisions

- Language: TypeScript on Node >= 22, ESM. The only runtime dependency is `smol-toml`. Tests use `node:test` with `tsx`.
- Ecosystems: Python first, then JavaScript/TypeScript (v0.2).
- Delivery: a JavaScript GitHub Action (`action.yml`, Node 24, bundled into `action-dist/`) and a CLI (`rsp check`), both thin wrappers around the same pure core.
- License: Apache-2.0.
- Releases are git tags `vX.Y.Z` on `main`. The version lives in `package.json` and `src/version.ts`, and a test keeps them in sync.
- The maintainer writes in Italian. Code, comments, commits and docs in the repository are in English.

## Principles that constrain every change

- **Facts, not judgements.** Messages state what changed ("Added `@ts-ignore` comment"), never advice.
- **Precision before recall.** When a case is ambiguous, the rule stays silent. A false fact costs more trust than a missed one.
- **Diff-scoped.** Rules look only at added or changed lines, so pre-existing debt is never reported. Lines moved between files are not new.
- **Reproducible.** Same commits and rsp version give byte-identical output. Rules use no network and no clock. Findings are sorted and carry a fingerprint that does not depend on line numbers.

## Code layout

- `src/engine.ts`, `src/context.ts`, `src/git.ts`, `src/diff.ts`: the core, from two commits to a `DiffContext`, then to sorted findings.
- `src/rules/`: one file per rule, each a pure function over `DiffContext`. Language helpers are in `python*.ts` and `js*.ts`.
- `src/report/`: JSON and Markdown output. `src/action.ts`: the GitHub Action (sticky PR comment, job summary, annotations).
- `test/fixtures/<rule>/<case>/`: golden cases, each with `base/`, `head/` and a hand-written `expected.json`.
- `eval/`: evaluation corpora and reports (see below).

## How a rule change is validated

Passing our own tests proves consistency, not that a rule works on real code. Every rule change goes through all four layers:

1. **Golden fixtures.** Add a case per new behaviour, positive and negative, with expectations written by hand before running the rule. Every case runs every rule, so a rule that fires on another rule's fixture fails too.
2. **Labelled mutations** (`npm run eval`). Risky and benign changes applied to the sample Python project (`eval/mutations.ts`) and to the maintainer's real app, MTGO Collection Tracker, cloned at a pinned commit (`eval/mutations-mtgo.ts`). The results files are committed and CI fails if they change.
3. **Real history** (`eval/real-history.ts`). Run the rules on about 100 recent commits of several public projects and check each finding against git independently of the rules. Every false fact found there gets fixed and becomes a golden fixture. This layer is where all false facts so far were found: aliased `TYPE_CHECKING`, optional imports, CI matrix keys, imports inside template literals, helper files in test folders, eslint replaced by oxlint.
4. **Action tests** against a fake GitHub API, including a run from the committed bundle.

After changing `src/`, run `npm run bundle` and commit `action-dist/`, because CI checks that it is up to date.

## Ideas not started

- Per-pattern configuration, for example accepting `# type: ignore` in a typed codebase (`.rsp.yml`, read from the base commit).
- Test delta: run the tests at base and head, and report tests that newly fail, disappeared or became skipped.
- Interface changes without test updates.
- An evaluation on AI-generated patches from public benchmarks such as SWE-bench.
