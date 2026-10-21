# rsp

A rule-based verifier for code changes. It reads the diff between two commits, runs bounded checks and reports only reproducible facts: which rule fired, where, on what evidence, and the exact command to reproduce it.

It does not review code with a model and does not certify that a change is correct. It points at specific, checkable risks that plausible-looking (often AI-generated) changes tend to introduce, such as tests switched off or suppressions added.

> Status: phase 0. The core, the CLI and the first rule (`checks/disabled`, Python) are in place. The GitHub Action and the other rules come next.

## Usage

```sh
npm ci && npm run build
node dist/cli.js check --base origin/main --head HEAD
node dist/cli.js check --base origin/main --format json
node dist/cli.js --list-rules
```

The base is resolved to its merge-base with the head, as for a pull request. The tool is advisory: findings never change the exit code. Exit code 2 means a usage error.

Example output:

```markdown
### rsp · 1 fact on 3f1c2a9b7d10..9e8d7c6b5a40 (rsp 0.0.0)

| Rule | Where | Fact | Evidence |
| --- | --- | --- | --- |
| checks/disabled | `tests/test_auth.py:6` | Added pytest skip marker | `@pytest.mark.skip(reason="flaky")` |

Reproduce: `npx rsp check --base 3f1c2a9b7d10... --head 9e8d7c6b5a40...`
```

## Rules

| Rule | Ecosystem | What it reports |
| --- | --- | --- |
| `checks/disabled` | Python | Deleted test files; added pytest/unittest skip and xfail, `# noqa`, `# type: ignore`, `# pylint: disable`, `# pragma: no cover`, `# nosec`. Lines only moved within a file are ignored. |

Planned for v0.1: `env/missing-example` and `deps/undeclared` for Python, CI workflow checks in `checks/disabled`, and the GitHub Action with a sticky PR comment.

## Design principles

- **Facts, not judgements.** A finding states what changed and where. Severity and blocking are configuration, not rule logic.
- **Reproducible.** Same commits and tool version give byte-identical output. Static rules use no network. Every finding carries a `reproduce` command and a fingerprint that stays stable when unrelated lines shift.
- **Diff-scoped.** Only added or changed lines are checked, so pre-existing debt is not reported.
- **Rules are pure functions** of the diff context, tested with golden fixtures.

## Development

```sh
npm ci
npm run typecheck
npm test
```

Golden fixtures live in `test/fixtures/<group>/<case>/`, each with a `base/` tree, a `head/` tree and the hand-written `expected.json`. The harness builds a throwaway git repository with fixed author and dates for each case, so fixture commit SHAs are stable, and runs every rule on it.

## License

[Apache-2.0](LICENSE)
