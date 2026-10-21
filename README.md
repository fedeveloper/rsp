# rsp

A rule-based verifier for code changes. It reads the diff of a pull request, runs bounded checks and reports only reproducible facts: which rule fired, where, on what evidence, and the exact command to reproduce it.

It does not review code with a model and does not certify that a change is correct. It points at specific, checkable risks that plausible-looking (often AI-generated) changes tend to introduce: tests switched off, suppressions added, dependencies or configuration forgotten.

## GitHub Action

```yaml
name: rsp
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  rsp:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: fedeveloper/rsp@v0.1.0
```

The action keeps one comment on the pull request up to date, writes the same report to the job summary, annotates the diff and exposes `findings` (count) and `report` (path of the JSON report) as outputs. It is advisory by default.

| Input | Default | Meaning |
| --- | --- | --- |
| `fail-on` | `never` | `any` fails the step when there is at least one finding |
| `exclude` | | Globs of changed files to ignore, one per line, e.g. `tests/fixtures/**` |
| `rules` | all | Rule ids to run, one per line |
| `comment` | `true` | `false` writes only the job summary |
| `github-token` | `github.token` | Token used for the comment |

On pull requests from forks the token is read-only: the comment is skipped with a warning and the job summary still has the report.

Example comment:

```markdown
### rsp · 2 facts on 3f1c2a9b7d10..9e8d7c6b5a40 (rsp 0.1.0)

| Rule | Where | Fact | Evidence |
| --- | --- | --- | --- |
| checks/disabled | `tests/test_auth.py:6` | Added pytest skip marker | `@pytest.mark.skip(reason="flaky")` |
| deps/undeclared | `app/client.py:3` | Imports `httpx`, not declared in pyproject.toml | `import httpx` |

Reproduce: `rsp check --base 3f1c2a9b7d10... --head 9e8d7c6b5a40...`
```

## Command line

```sh
npm install -g github:fedeveloper/rsp#v0.1.0
rsp check --base origin/main --head HEAD
rsp check --base origin/main --format json --exclude 'tests/fixtures/**'
rsp --list-rules
```

The base is resolved to its merge-base with the head, as for a pull request. Findings never change the exit code; 2 means a usage error.

## Rules

All rules look only at lines added or changed by the diff, so pre-existing debt is not reported. Python is the first supported ecosystem.

| Rule | Reports | Deliberately ignores |
| --- | --- | --- |
| `checks/disabled` | Deleted test files; fewer assertions across the changed tests; added pytest/unittest skip and xfail, `# noqa`, `# type: ignore`, `# pylint: disable`, `# pragma: no cover`, `# nosec`; CI lines running a checker removed, `continue-on-error: true`, `\|\| true`, `if: false` in workflows; pytest `--deselect`/`--ignore`; a lower coverage threshold | Lines moved between files; tests moved to another file |
| `deps/undeclared` | New imports whose package is not declared in `pyproject.toml` (PEP 621, PEP 735 groups, Poetry, PDM, uv), `requirements*.txt`, `setup.cfg` or literal lists in `setup.py` | Standard library, modules of the repository itself, relative imports, imports under `if TYPE_CHECKING` or in `try`/`except ImportError`, repositories with no manifest |
| `env/missing-example` | Environment variables read by literal name (`os.getenv`, `os.environ[...]`, `os.environ.get`) that are missing from `.env.example` or a similar file | Variables set by the OS or CI, writes to `os.environ`, reads moved from elsewhere, repositories with no example file |

## How it is tested

- **Golden fixtures** (`test/fixtures/<rule>/<case>/`): a `base/` tree, a `head/` tree and hand-written `expected.json` for each positive, negative and edge case. The harness builds a throwaway git repository per case, with fixed author and dates so SHAs are stable, and runs every rule on it.
- **Labelled mutations** (`eval/`): a small sample project and 39 mutations of it, 23 risky and 16 benign. `npm run eval` checks that each risky mutation is reported by the expected rules and each benign one by none, and writes [eval/RESULTS.md](eval/RESULTS.md). CI fails if the results change.
- **Real history** (`eval/real-history.ts`): every rule run on 500 recent commits of five Python projects, with each line-level finding checked against git independently of the rules. See [eval/REAL_HISTORY.md](eval/REAL_HISTORY.md).
- **Action tests**: the action runs against a fake GitHub API (comment created, updated, cleared, skipped on read-only tokens, `fail-on`), and once from the committed bundle.

## Design principles

- **Facts, not judgements.** A finding states what changed and where. Whether it blocks is configuration.
- **Reproducible.** Same commits and tool version give byte-identical output. Rules use no network. Every finding carries a `reproduce` command and a fingerprint that stays stable when unrelated lines shift.
- **Precision before recall.** When a case is ambiguous, rules stay silent.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run eval
npm run bundle   # rebuild action-dist/ after changing src/
```

## License

[Apache-2.0](LICENSE)
