# rsp

**Reproducible Signals for Pull requests** (working name).

rsp is a rule-based verifier for code changes. It reads the diff of a pull request, runs a fixed set of bounded checks and reports only reproducible facts: which rule fired, in which file and on which line, on what evidence, and the exact command that produces the same finding again.

```markdown
### rsp · 3 facts on 3f1c2a9b7d10..9e8d7c6b5a40 (rsp 0.3.0)

| Rule | Where | Fact | Evidence |
| --- | --- | --- | --- |
| checks/disabled | `tests/test_auth.py:6` | Added pytest skip marker | `@pytest.mark.skip(reason="flaky")` |
| deps/undeclared | `app/client.py:3` | Imports `httpx`, not declared in pyproject.toml | `import httpx` |
| tests/delta | `junit.xml` | Test `tests.test_auth::test_login` fails at head and passed at base | `tests.test_auth::test_login: passed -> failed` |

Reproduce: `rsp check --base 3f1c2a9b7d10... --head 9e8d7c6b5a40...`
```

It does not review code with a model, it does not score changes and it never says whether a change is correct. It points at a small number of specific, checkable things that plausible-looking changes tend to get wrong, and leaves the judgement to the people reviewing.

- [Why rsp exists](#why-rsp-exists)
- [Principles](#principles)
- [Quick start](#quick-start)
- [What rsp reports](#what-rsp-reports)
- [Configuration: `.rsp.toml`](#configuration-rsptoml)
- [Test results before and after](#test-results-before-and-after)
- [Integrating rsp into your workflow](#integrating-rsp-into-your-workflow)
- [Output](#output)
- [GitHub Action reference](#github-action-reference)
- [Command line reference](#command-line-reference)
- [How rsp is validated](#how-rsp-is-validated)
- [Limitations](#limitations)
- [FAQ](#faq)
- [Development](#development)

## Why rsp exists

Coding assistants and agents now write a large share of pull requests. Their changes usually look right: they compile, they read well, and the summary says the task is done. The failures that remain are the plausible-but-wrong kind, and many of them come from the same few shortcuts taken to make something "work":

- a failing test is skipped, marked as expected to fail, or deleted;
- a type or lint error is silenced with `# type: ignore`, `@ts-ignore` or `eslint-disable` instead of fixed;
- a CI step that was failing is removed, or allowed to fail with `|| true` or `continue-on-error`;
- a new package is imported but never added to the dependency manifest, so it works only on the machine where it happened to be installed;
- the code starts reading an environment variable that nobody documented in `.env.example`;
- the parameters of a public function change and no test is updated to match;
- tests that passed before the change fail, or quietly stop running, after it.

None of these needs a model to detect. Each is a mechanical property of the diff, and each is easy to miss when reading a large change that otherwise looks fine. rsp checks for exactly these, and nothing more, so that a reviewer can spend attention on what only a person can judge.

The same checks are just as useful on changes written by people: the shortcuts are human ones first.

## Principles

These constrain every rule and every change to rsp.

- **Facts, not judgements.** A finding says what changed ("Added `@ts-ignore` comment", "Imports `httpx`, not declared in pyproject.toml"), never that it is bad or what to do. A skipped test can be the right call; rsp only makes sure it is a visible one.
- **Precision before recall.** When a case is ambiguous, the rule stays silent. A false fact costs more trust than a missed one, so rules give up coverage to avoid reporting things that are not true.
- **Diff-scoped.** Rules look only at lines added or changed by the pull request. Pre-existing debt is never reported, and lines moved from one file to another are not new.
- **Reproducible.** The same two commits and the same rsp version give byte-identical output. Rules use no network and no clock. Findings are sorted and carry a fingerprint that does not depend on line numbers, and every finding carries the command that reproduces it.
- **Advisory by default.** Whether a finding blocks a merge is your configuration. Out of the box rsp comments and never fails the build.

## Quick start

Add a workflow to the repository, for example `.github/workflows/rsp.yml`:

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
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0 # rsp needs the base commit too
      - uses: fedeveloper/rsp@v0.3.0
```

On every pull request rsp keeps one comment up to date with its findings, writes the same report to the job summary, adds annotations to the diff and sets two outputs: `findings` (the count) and `report` (the path of the JSON report). When a later push removes every finding, the comment says so instead of disappearing.

To try it locally first:

```sh
npm install -g github:fedeveloper/rsp#v0.3.0
cd your-repo
rsp check --base origin/main
```

rsp needs Node 22 or later and git. It supports Python and JavaScript/TypeScript (Node and front-end code); the CI checks work for any GitHub Actions workflow.

## What rsp reports

There are five rules. Each looks at the diff between the merge-base of the pull request and its head, and each finding has a **key**, which is what you name in `.rsp.toml` to accept that kind of finding (see [Configuration](#configuration-rsptoml)). `rsp --list-rules` prints the same information.

### `checks/disabled`

Checks that were removed or switched off.

| What | Example | Key |
| --- | --- | --- |
| pytest skip and xfail markers | `@pytest.mark.skip(reason="flaky")` | `pytest-skip`, `pytest-xfail` |
| `pytest.skip()` called inside a test | `pytest.skip("todo")` | `pytest-skip-call` |
| unittest skips | `@unittest.skip`, `@unittest.skipIf`, `@unittest.expectedFailure` | `unittest-skip` |
| JS/TS skipped or focused tests | `it.skip`, `test.skipIf`, `xit`, `describe.only` | `test-skip`, `test-only` |
| Python suppressions | `# noqa`, `# type: ignore`, `# pylint: disable`, `# nosec` | `noqa`, `type-ignore`, `pylint-disable`, `nosec` |
| Coverage exclusions | `# pragma: no cover`, `/* istanbul ignore next */`, `c8 ignore`, `v8 ignore` | `coverage-exclusion` |
| JS/TS suppressions | `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, `biome-ignore` | `eslint-disable`, `ts-ignore`, `ts-nocheck`, `ts-expect-error`, `biome-ignore` |
| Test files deleted | `tests/test_store.py` removed | `test-file-deleted` |
| Fewer assertions across the changed tests | 12 `assert` before, 9 after | `fewer-assertions` |
| A CI line running a checker removed | `- run: mypy src` deleted | `ci-check-removed` |
| CI steps allowed to fail | `continue-on-error: true`, `pytest \|\| true`, `\|\| exit 0`, `if: false` | `continue-on-error`, `or-true`, `or-exit-0`, `if-false` |
| pytest told to skip tests | `--deselect`, `--ignore` in `addopts` | `pytest-exclude-option` |
| Lower coverage threshold | `fail_under = 85` → `60` | `coverage-threshold-lowered` |
| A package.json script stops running a check | `"lint": "eslint ."` → `"lint": "true"` | `script-check-removed` |
| TypeScript strictness turned off | `"strict": false` in tsconfig | `ts-strict-off` |
| ESLint rules turned off | `"no-unused-vars": "off"` | `eslint-rule-off` |

It deliberately ignores lines moved between files, tests moved to another file, a checker replaced by one of the same kind (eslint by oxlint, jest by vitest, flake8 by ruff), `@ts-expect-error` inside test files (where it is the assertion), and helper files that live in test folders but contain no tests.

### `deps/undeclared`

Imports added by the diff whose package is not declared in a dependency manifest. The key is the imported module (Python) or package (JavaScript).

- **Python** imports are checked against `pyproject.toml` (PEP 621 dependencies and optional dependencies, PEP 735 dependency groups, Poetry, PDM and uv), `requirements*.txt`, `setup.cfg` and literal lists in `setup.py`. Import names are mapped to distribution names where they differ (`yaml` is `PyYAML`, `sklearn` is `scikit-learn`).
- **JavaScript/TypeScript** `import`, `export ... from` and `require()` are checked against every `package.json` between the file and the repository root, including `@types/` packages.

It ignores the standard library and Node built-ins, the repository's own modules and workspace packages, relative imports, tsconfig path aliases, imports under `if TYPE_CHECKING:` or inside `try`/`except` (Python) or `try`/`catch` (JS), dynamic `import()`, code inside strings and template literals, and repositories with no manifest at all.

### `env/missing-example`

Environment variables read by literal name in added code that are missing from the repository's example env file (`.env.example`, `.env.sample`, `.env.local.example`, `example.env`, ...). The key is the variable name.

- **Python**: `os.getenv("X")`, `os.environ["X"]`, `os.environ.get("X")`.
- **JavaScript/TypeScript**: `process.env.X`, `process.env["X"]`, destructuring from `process.env`, `import.meta.env.X`, `Deno.env.get("X")`, `Bun.env.X`.

It ignores variables set by the OS, Node, Vite or CI (`HOME`, `NODE_ENV`, `import.meta.env.MODE`, `GITHUB_*` and similar), writes to the environment, reads moved from elsewhere in the repository, and repositories without an example file: no example file means there is no convention to keep up.

### `interface/untested-change`

Public functions whose parameters changed while no test file changed by the diff mentions them. The key is the function name, such as `load_settings` or `Store.add`.

A change means a parameter added or removed, a new or changed default, a different order, or a rename where callers can pass the parameter by name. For Python this covers public top-level functions and methods of public classes; for JavaScript/TypeScript, exported functions and exported arrow functions.

It ignores changes to annotations and formatting only, renames of JavaScript positional parameters (callers cannot see them), private names (`_helper`), typed overloads that add no new parameter list, functions that a changed test mentions, files that are themselves tests, and repositories with no tests at all.

### `tests/delta`

Differences between the test results at base and at head, read from JUnit XML reports. It runs only when reports are given; see [Test results before and after](#test-results-before-and-after). The key is the test id, `classname::name` as in the report, or `no-tests`.

- A test that passed at base and fails at head.
- A test that ran at base and is skipped at head.
- A test that ran at base and is missing at head, reported only when the head suite is smaller than the base one, so renamed and moved tests are not reported as missing.
- No test results at all at head when there were some at base.

Tests that already failed at base are not reported: they are not caused by the pull request.

## Configuration: `.rsp.toml`

rsp works without configuration. When a repository needs exceptions, it adds `.rsp.toml` at its root:

```toml
# Never look at these files, for any rule.
exclude = ["vendor/**", "tests/fixtures/**"]

[rules."checks/disabled"]
# This codebase is typed and accepts targeted ignores.
allow = ["type-ignore"]
# Generated clients are full of suppressions.
exclude = ["src/generated/**"]

[rules."deps/undeclared"]
# Provided by the runtime image, not by pyproject.toml.
allow = ["boto3", "botocore"]

[rules."env/missing-example"]
enabled = false
```

| Key | Meaning |
| --- | --- |
| `exclude` | Globs of changed files hidden from every rule. |
| `rules."<id>".enabled` | `false` turns the rule off. A rule named explicitly with `--rule` or the `rules` input still runs. |
| `rules."<id>".allow` | Finding keys the rule does not report: pattern ids for `checks/disabled`, packages, variables, function names or test ids for the others. |
| `rules."<id>".exclude` | Globs of files whose findings this rule does not report. |

Two properties are worth knowing:

- **The configuration is read from the base commit**, never from the head. A pull request cannot relax the checks it is held to by editing `.rsp.toml` in the same change; the new configuration applies from the next pull request after it is merged. The report says when a configuration was used ("Configuration: `.rsp.toml` from the base commit.").
- **Mistakes are errors, not warnings.** An unknown key, an unknown rule or an unknown pattern id in `allow` stops the run with a message that lists the valid values, because a typo must not silently turn a check off. In the Action this fails the step with `rsp configuration is invalid: ...`.

`--no-config` ignores the file, which is useful to see everything once.

## Test results before and after

The `tests/delta` rule compares the results of the test suite at the base commit and at the head commit. It reads standard JUnit XML, which almost every test runner can write:

| Runner | How to write JUnit XML |
| --- | --- |
| pytest | `pytest --junitxml=junit.xml` |
| unittest | `python -m xmlrunner` (unittest-xml-reporting) or run the tests through pytest |
| Vitest | `vitest run --reporter=junit --outputFile=junit.xml` |
| Jest | `jest --reporters=default --reporters=jest-junit` (writes `junit.xml`) |
| Mocha | `mocha --reporter mocha-junit-reporter` |
| node:test | `node --test --test-reporter=junit --test-reporter-destination=junit.xml` |
| Go | `gotestsum --junitfile junit.xml` |

### In the GitHub Action

Give the Action the command that installs dependencies and runs the tests:

```yaml
- uses: actions/setup-python@v6
  with:
    python-version: "3.12"
- uses: fedeveloper/rsp@v0.3.0
  with:
    test-command: pip install -e '.[test]' && pytest --junitxml=junit.xml
```

rsp then checks out the base and the head each in its own git worktree under the runner's temporary directory, runs the command in each (in collapsible log groups), collects the files matching `junit` (default `**/junit*.xml`) and compares them. The worktrees are removed afterwards. If tests fail at head that passed at base, the head run is repeated up to `test-retries` times (default 1) and a test that passes in any run counts as passing, so a flaky test does not become a finding. The exit code of the test command is logged but does not matter: a test suite with failures is exactly what the rule reads.

Running the suite twice doubles the test time of the job. For a slow suite, put rsp in its own job so it runs in parallel with your normal CI.

### From the command line, or with reports you already have

If your CI already runs the tests on the base branch and on the pull request, pass the reports directly:

```sh
rsp check --base origin/main --junit-base base/junit.xml --junit-head head/junit.xml
```

Both options are repeatable for sharded suites; results from several files of the same commit are merged, and a test that passed in any of them counts as passed.

## Integrating rsp into your workflow

### 1. Start advisory

Add the [quick start](#quick-start) workflow and leave `fail-on` at `never`. For a week or two, read the comments on real pull requests. Every finding should be true; if you ever see one that is not, that is a bug in rsp and worth [an issue](https://github.com/fedeveloper/rsp/issues). What you will see instead are true findings that your team considers fine, such as `# type: ignore` in a typed codebase.

### 2. Encode your conventions

Turn each accepted pattern into `.rsp.toml` (`allow`, `exclude` or `enabled = false`) and merge it. Because the file is read from the base commit, it starts applying to the next pull request, and every later relaxation goes through review as a change of its own.

### 3. Decide what blocks

When the remaining findings are ones you want to stop at, set `fail-on: any`:

```yaml
- uses: fedeveloper/rsp@v0.3.0
  with:
    fail-on: any
```

and make the check required in branch protection. Findings that should stay informational can run in a second, non-blocking step with `rules:` limited to them, and be turned off in `.rsp.toml` for the blocking one.

### Pull requests from coding agents

rsp is designed for the pull requests that coding agents open: they are large, they look finished, and the shortcuts listed above are exactly the ones agents take when a test or a type check stands between them and "done".

- **In CI.** The Action runs on agent pull requests like on any other. Many teams make it blocking only for them, for example with `if: github.actor == 'my-agent[bot]'` on a `fail-on: any` step.
- **Inside the agent's loop.** Give the agent the command and ask it to run it before it reports the task as done: `rsp check --base origin/main --format json`. The JSON is easy for an agent to read, and because findings are facts rather than opinions, the agent can either fix the change or explain each finding in the pull request description. For Claude Code this fits a project instruction in `CLAUDE.md` or a hook on stop; other agents have equivalent hooks.
- **Before a push.** As a git hook, `.git/hooks/pre-push`:

  ```sh
  #!/bin/sh
  rsp check --base origin/main || exit 0
  ```

  This prints findings without blocking; the exit code of `rsp check` never depends on findings, only on usage errors.

### Monorepos

Run rsp once at the repository root. `deps/undeclared` resolves each JavaScript file against the nearest `package.json` files up to the root and knows workspace packages; Python files are checked against all Python manifests in the repository. Use `exclude` for generated or vendored directories.

### Forks

On pull requests from forks the `github.token` is read-only, so the comment is skipped with a warning; the job summary and annotations still carry the full report. A `test-command` runs code from the pull request, so treat it like any other step that runs the tests of a fork.

### Other CI systems

The CLI is self-contained. In any CI with git and Node 22:

```sh
npx --yes github:fedeveloper/rsp#v0.3.0 check --base "$TARGET_BRANCH" --format json > rsp.json
```

and turn `rsp.json` into whatever your CI shows. With `--format markdown` (the default) the output can be posted as a merge request comment as is.

## Output

The Markdown report is the comment shown above. The JSON report, from `--format json` or the `report` output of the Action, has this shape:

```json
{
  "base": "0d21a9495c6e4b1a528fe417fd596b776e82a471",
  "config": null,
  "findings": [
    {
      "evidence": "@pytest.mark.skip(reason=\"flaky\")",
      "fingerprint": "694ef6356a2d3ab2",
      "key": "pytest-skip",
      "locations": [{ "line": 6, "path": "tests/test_auth.py" }],
      "message": "Added pytest skip marker",
      "reproduce": "rsp check --base 0d21a94... --head 1d2dc83... --rule checks/disabled",
      "ruleId": "checks/disabled",
      "ruleVersion": "0.3.0"
    }
  ],
  "head": "1d2dc83171117d1cd416497dbf8f687b2dd6b1f6",
  "options": [],
  "rules": [{ "id": "checks/disabled", "version": "0.3.0" }],
  "tool": { "name": "rsp", "version": "0.3.0" }
}
```

- `fingerprint` identifies a finding across pushes: it is built from the rule, the file and the evidence, not from line numbers, so it stays the same when unrelated lines move. Use it to track findings over time.
- `reproduce` is the full command, including any options that affected the result (`--exclude`, `--no-config`, JUnit reports).
- Keys and objects are sorted, and findings are sorted by rule, path and line, so two runs on the same commits give the same bytes.

## GitHub Action reference

| Input | Default | Meaning |
| --- | --- | --- |
| `fail-on` | `never` | `any` fails the step when there is at least one finding. |
| `exclude` | | Globs of changed files to ignore, one per line or comma separated, e.g. `tests/fixtures/**`. Added to the `exclude` of `.rsp.toml`. |
| `rules` | all | Rule ids to run, one per line or comma separated. |
| `test-command` | | Shell command that installs dependencies and runs the tests, writing JUnit XML. Enables `tests/delta`. |
| `junit` | `**/junit*.xml` | Glob of the JUnit files the test command writes, relative to the repository root. |
| `test-retries` | `1` | Extra runs at head while tests fail there but passed at base. |
| `comment` | `true` | `false` writes only the job summary. |
| `github-token` | `github.token` | Token used for the comment. Needs `pull-requests: write`. |

| Output | Meaning |
| --- | --- |
| `findings` | Number of findings. |
| `report` | Path of the JSON report. |

The Action needs the full history of both commits: use `actions/checkout` with `fetch-depth: 0`. It runs only on `pull_request` and `pull_request_target` events and skips other events with a notice.

## Command line reference

```text
Usage: rsp check --base <ref> [--head <ref>] [options]

Options:
  --base <ref>      Commit, branch or tag to compare against (required)
  --head <ref>      Commit to check (default: HEAD)
  --repo <dir>      Repository directory (default: current directory)
  --format <fmt>    json or markdown (default: markdown)
  --rule <id>       Run only this rule; repeatable
  --exclude <glob>  Ignore changed files matching this glob; repeatable
  --no-config       Ignore .rsp.toml in the base commit
  --junit-base <f>  JUnit report of the tests run at base; repeatable
  --junit-head <f>  JUnit report of the tests run at head; repeatable
  --list-rules      Print the available rules and exit
  --version         Print the version and exit
  --help            Print this help and exit
```

The base is resolved to its merge-base with the head, exactly as GitHub computes the diff of a pull request. Findings never change the exit code: 0 means rsp ran, 2 a usage or configuration error.

## How rsp is validated

Passing its own tests proves that rsp is consistent, not that its rules work on real code. Every rule change goes through four layers, and a fifth evaluation measures rsp on patches written by coding agents.

1. **Golden fixtures** (`test/fixtures/<rule>/<case>/`). Each case is a `base/` tree, a `head/` tree and an `expected.json` written by hand before running the rule. The harness builds a throwaway git repository per case with fixed authors and dates, and runs **every** rule on **every** case, so a rule that fires on another rule's fixture fails too.
2. **Labelled mutations** (`npm run eval`). Risky and benign changes are applied to each corpus; each risky change must be reported by exactly the expected rules and each benign one by none. CI fails if the results change.
   - A small sample Python project: [eval/RESULTS.md](eval/RESULTS.md).
   - [MTGO Collection Tracker](https://github.com/fedeveloper/MTGO-Collection-Tracker), a real Node, Express and React application, at a pinned commit: [eval/RESULTS-mtgo.md](eval/RESULTS-mtgo.md).
   - Corpora on private code can be added without committing them: `RSP_EVAL_EXTRA=<file>` loads one from outside the repository (see `eval/run.ts`). The maintainer uses this for a private Python game with no manifests, tests or CI, to check that rules stay silent where a convention does not exist.
3. **Real history** (`eval/real-history.ts`). Every rule runs on about 100 recent commits of public projects, and each line-level finding is checked against git independently of the rules: the reported line holds the evidence, the line occurs more often after the commit than before, and for signatures the definition really changed. Python: flask, requests, httpx, fastapi, click ([eval/REAL_HISTORY.md](eval/REAL_HISTORY.md)). JavaScript/TypeScript: MTGO Collection Tracker, express, axios, fastify, vite, outline ([eval/REAL_HISTORY_JS.md](eval/REAL_HISTORY_JS.md)). Every false fact found this way was fixed and became a golden fixture.
4. **Action tests** against a fake GitHub API: comment created, updated and cleared, read-only tokens, `fail-on`, invalid configuration, the test command at base and head with a flaky rerun, and one run from the committed bundle.

### Patches written by coding agents

`eval/swe-bench.ts` runs rsp on the 300 tasks of [SWE-bench Lite](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Lite), real issues of 12 Python projects. For each task it checks the pull request that fixed the issue and the patches written by three agents from public leaderboard submissions (SWE-agent with Claude 4 Sonnet, Agentless Lite with o3-mini, Moatless Tools with DeepSeek V3). The full report is [eval/SWE_BENCH.md](eval/SWE_BENCH.md).

| Patches by | Patches | With findings | Resolved, with findings | Not resolved, with findings |
| --- | --- | --- | --- | --- |
| Human fix (code and test patch) | 300 | 10 (3%) | | |
| SWE-agent + Claude 4 Sonnet | 300 | 11 (4%) | 4 of 170 | 7 of 130 |
| Agentless Lite + o3-mini | 294 | 4 (1%) | 2 of 97 | 2 of 197 |
| Moatless Tools + DeepSeek V3 | 287 | 0 | 0 of 92 | 0 of 195 |

What this shows, and what it does not:

- **Findings are rare, as intended.** SWE-bench tasks are small bug fixes, and rsp only speaks when one of its specific facts is true. On the human fixes, every finding is a deliberate skip marker or a test that lost assertions while being rewritten.
- **The agent findings are the shortcuts rsp is for.** One agent patch deletes the project's whole test file (`test_requests.py`); others add `# type: ignore`, or add parameters to public functions without touching a test. Of the 11 SWE-agent findings, 7 are on patches that did not resolve their task.
- **The first run found false facts, now fixed.** Skip markers and imports inside Python strings (pytest's own tests write test code into strings), dependency lists built in `setup.py` variables or imported from another module, `pytest` imported by test files of projects that declare it in tox or conda files, a method defined twice in one class, and a backslash at the end of a docstring line that shifted line numbers. Each became a golden fixture.
- **It is not a detector of wrong patches.** Most unresolved patches have no finding, because most wrong patches are wrong in ways only tests or a reviewer can see. `tests/delta` with the task's tests would see more, and is not part of this run.

## Limitations

- **rsp is not a reviewer.** No findings does not mean a change is correct, only that none of these specific things happened.
- **Bounded on purpose.** Rules use line-level parsing tuned for precision, not full parsers. Unusual syntax is more likely to be missed than misreported.
- **Two ecosystems.** Python and JavaScript/TypeScript. CI checks cover GitHub Actions workflows.
- **Interface changes are about parameters.** Return types, behaviour and class attributes are not compared, and "a test mentions it" is a name match, not coverage.
- **Test delta costs a second test run** and is only as good as the JUnit report: tests that the runner does not report, such as doctests in some setups, are not seen.

## FAQ

**Why not use an LLM to review the diff?**
Because a model's review is an opinion, and it can be confidently wrong in exactly the cases rsp is for. rsp's findings can be checked by anyone in seconds and come out the same on every run. The two are complementary: rsp is cheap enough to run on every push and leaves a model, or a person, free to judge the rest.

**Will rsp complain about the existing `# type: ignore` all over my code?**
No. Only lines added or changed by the pull request are looked at.

**A finding is correct but we do this on purpose. What now?**
Add its key to `allow` for that rule in `.rsp.toml`, or exclude the files where it is expected. The comment shows the key-relevant evidence, and `rsp --list-rules` lists the keys.

**Why is the configuration read from the base commit?**
So that a pull request cannot switch off the checks that apply to it. Changing `.rsp.toml` is itself a reviewed change.

**Does rsp send my code anywhere?**
No. The rules run locally on the git objects of the repository and use no network. The Action talks only to the GitHub API, to write the comment.

**Does it work with squash merges, rebases and stacked pull requests?**
rsp compares the head with its merge-base with the base, like GitHub's own pull request diff, so it reports the same changes the pull request shows.

**How do I see everything without my configuration?**
`rsp check --base origin/main --no-config`.

**Why "facts" and not "warnings"?**
A warning implies the change is wrong. "Added pytest skip marker" is simply true, and whether that is acceptable depends on context only the team has.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run eval      # labelled mutations; RSP_EVAL_EXTRA=<file> adds a corpus kept outside the repository
npm run bundle    # rebuild action-dist/ after changing src/; CI checks it is up to date
node --import tsx eval/real-history.ts --commits 100 --out eval/REAL_HISTORY.md <repo-dirs>
node --import tsx eval/swe-bench.ts
```

TypeScript on Node 22 or later, ESM, with `smol-toml` as the only runtime dependency. The core (`src/engine.ts`, `src/context.ts`, `src/git.ts`, `src/diff.ts`) turns two commits into a diff context and sorted findings; each rule in `src/rules/` is a pure function of that context. The Action (`src/action.ts`) and the CLI (`src/cli.ts`) are thin wrappers around the same core. [CLAUDE.md](CLAUDE.md) records why things are built the way they are and how changes are expected to be validated.

Releases are git tags `vX.Y.Z` on `main`; the version lives in `package.json` and `src/version.ts`, and a test keeps them in sync.

## License

[Apache-2.0](LICENSE)
