# User guide

How to configure RSP, feed it test results and coverage, fit it into a workflow, and read its output. For what each rule reports, see [RULES.md](RULES.md).

Back to the [README](../README.md) · [Rules](RULES.md) · [How RSP is validated](VALIDATION.md)

- [Configuration: `.rsp.toml`](#configuration-rsptoml)
- [Test results before and after](#test-results-before-and-after)
- [Coverage of added lines](#coverage-of-added-lines)
- [Integrating RSP into your workflow](#integrating-rsp-into-your-workflow)
- [Output](#output)
- [GitHub Action reference](#github-action-reference)
- [Command line reference](#command-line-reference)
- [Security](#security)

## Configuration: `.rsp.toml`

RSP works without configuration. When a repository needs exceptions, it adds `.rsp.toml` at its root:

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
- uses: fedeveloper/rsp@v0
  with:
    test-command: pip install -e '.[test]' && pytest --junitxml=junit.xml
```

The test command runs the pull request's code, so RSP runs it with care: without the Action's inputs (which hold the GitHub token) or the runtime tokens of Actions in its environment, without the files through which a step changes later steps (`GITHUB_ENV`, `GITHUB_OUTPUT`, `GITHUB_PATH`), and with workflow commands switched off while it prints. It refuses to run on `pull_request_target`, and warns when the checkout left a token in `.git/config` (use `persist-credentials: false`). See [Security](#security).

RSP then checks out the base and the head each in its own git worktree under the runner's temporary directory, runs the command in each (in collapsible log groups), collects the files matching `junit` (default `**/junit*.xml`) and compares them. The worktrees are removed afterwards. If tests fail at head that passed at base, the head run is repeated up to `test-retries` times (default 1) and a test that passes in any run counts as passing, so a flaky test does not become a finding. The exit code of the test command is logged but does not matter: a test suite with failures is exactly what the rule reads.

Running the suite twice doubles the test time of the job. For a slow suite, put RSP in its own job so it runs in parallel with your normal CI.

### From the command line, or with reports you already have

If your CI already runs the tests on the base branch and on the pull request, pass the reports directly:

```sh
rsp check --base origin/main --junit-base base/junit.xml --junit-head head/junit.xml
```

Both options are repeatable for sharded suites; results from several files of the same commit are merged, and a test that passed in any of them counts as passed.

## Coverage of added lines

The `tests/uncovered-change` rule reads a line coverage report of the tests at head:

| Runner | How to write the report |
| --- | --- |
| pytest | `pytest --cov --cov-report=xml` (pytest-cov, writes `coverage.xml`) |
| coverage.py | `coverage xml` or `coverage lcov` |
| Vitest | `vitest run --coverage --coverage.reporter=lcov` (writes `coverage/lcov.info`) |
| Jest | `jest --coverage --coverageReporters=lcov` |
| c8, nyc | `--reporter=lcov` |

In the Action, set `coverage` to a glob of the report the test command writes; it is collected from the first run at head:

```yaml
- uses: fedeveloper/rsp@v0
  with:
    test-command: pip install -e '.[test]' && pytest --junitxml=junit.xml --cov --cov-report=xml
    coverage: coverage.xml
```

From the command line, pass `--coverage <file>`, repeatable. Paths in the report are matched to the repository's files by their longest common ending, so absolute paths written on another machine still match.

## Integrating RSP into your workflow

### 1. Start advisory

Add the [quick start](../README.md#quick-start) workflow and leave `fail-on` at `never`. For a week or two, read the comments on real pull requests. Every finding should be true; if you ever see one that is not, that is a bug in RSP and worth [an issue](https://github.com/fedeveloper/rsp/issues). What you will see instead are true findings that your team considers fine, such as `# type: ignore` in a typed codebase.

### 2. Encode your conventions

Turn each accepted pattern into `.rsp.toml` (`allow`, `exclude` or `enabled = false`) and merge it. Because the file is read from the base commit, it starts applying to the next pull request, and every later relaxation goes through review as a change of its own.

### 3. Decide what blocks

When the remaining findings are ones you want to stop at, set `fail-on: any`:

```yaml
- uses: fedeveloper/rsp@v0
  with:
    fail-on: any
```

and make the check required in branch protection. Findings that should stay informational can run in a second, non-blocking step with `rules:` limited to them, and be turned off in `.rsp.toml` for the blocking one.

### Pull requests from coding agents

RSP is designed for the pull requests that coding agents open: they are large, they look finished, and the shortcuts listed above are exactly the ones agents take when a test or a type check stands between them and "done".

- **In CI.** The Action runs on agent pull requests like on any other. Many teams make it blocking only for them, for example with `if: github.actor == 'my-agent[bot]'` on a `fail-on: any` step.
- **Inside the agent's loop.** Give the agent the command and ask it to run it before it reports the task as done: `rsp check --base origin/main --format json`. The JSON is easy for an agent to read, and because findings are facts rather than opinions, the agent can either fix the change or explain each finding in the pull request description. For Claude Code this fits a project instruction in `CLAUDE.md` or a hook on stop; other agents have equivalent hooks.
- **Before a push.** As a git hook, `.git/hooks/pre-push`:

  ```sh
  #!/bin/sh
  rsp check --base origin/main || exit 0
  ```

  This prints findings without blocking; the exit code of `rsp check` never depends on findings, only on usage errors.

### Monorepos

Run RSP once at the repository root. `deps/undeclared` resolves each JavaScript file against the nearest `package.json` files up to the root and knows workspace packages; Python files are checked against all Python manifests in the repository. Use `exclude` for generated or vendored directories.

### Forks

On pull requests from forks the `github.token` is read-only, so the comment is skipped with a warning; the job summary and annotations still carry the full report. A `test-command` runs code from the pull request, so treat it like any other step that runs the tests of a fork: use the `pull_request` event, never `pull_request_target`.

### Other CI systems

The CLI is self-contained. In any CI with git and Node 22:

```sh
npx --yes github:fedeveloper/rsp#v0.5.0 check --base "$TARGET_BRANCH" --format json > rsp.json
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
      "ruleVersion": "0.4.0"
    }
  ],
  "head": "1d2dc83171117d1cd416497dbf8f687b2dd6b1f6",
  "options": [],
  "rules": [{ "id": "checks/disabled", "version": "0.4.0" }],
  "tool": { "name": "rsp", "version": "0.5.0" }
}
```

- `fingerprint` identifies a finding across pushes: it is built from the rule, the file and the evidence, not from line numbers, so it stays the same when unrelated lines move. Use it to track findings over time.
- `reproduce` is the full command, including any options that affected the result (`--exclude`, `--no-config`, JUnit and coverage reports).
- `tests` is present when JUnit reports were given: `flaky` lists tests that failed and also passed at head, and `incomplete` lists head reports that were cut off. They describe the test run, not the diff, so they are not findings.
- Keys and objects are sorted, and findings are sorted by rule, path and line, so two runs on the same commits give the same bytes.

## GitHub Action reference

| Input | Default | Meaning |
| --- | --- | --- |
| `fail-on` | `never` | `any` fails the step when there is at least one finding. |
| `exclude` | | Globs of changed files to ignore, one per line or comma separated, e.g. `tests/fixtures/**`. Added to the `exclude` of `.rsp.toml`. |
| `rules` | all | Rule ids to run, one per line or comma separated. |
| `test-command` | | Shell command that installs dependencies and runs the tests, writing JUnit XML. Enables `tests/delta`. |
| `junit` | `**/junit*.xml` | Glob of the JUnit files the test command writes, relative to the repository root. |
| `coverage` | empty | Glob of the LCOV or Cobertura reports the test command writes at head, for `tests/uncovered-change`. |
| `test-retries` | `1` | Extra runs at head while tests fail there but passed at base. |
| `comment` | `true` | `false` writes only the job summary. |
| `github-token` | `github.token` | Token used for the comment. Needs `pull-requests: write`. |

| Output | Meaning |
| --- | --- |
| `findings` | Number of findings. |
| `report` | Path of the JSON report. |

The Action needs the full history of both commits: use `actions/checkout` with `fetch-depth: 0`. It runs on events that carry a pull request (`pull_request`, and `pull_request_target` without `test-command`) and skips other events with a notice.

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
  --coverage <f>    LCOV or Cobertura coverage report of the tests at head; repeatable
  --list-rules      Print the available rules and exit
  --version         Print the version and exit
  --help            Print this help and exit
```

The base is resolved to its merge-base with the head, exactly as GitHub computes the diff of a pull request. Findings never change the exit code: 0 means RSP ran, 2 a usage or configuration error.

## Security

RSP reads untrusted input, the pull request, and writes to it, so it is built to give that input as little as possible.

- **Least privilege.** The Action needs `contents: read`, plus `pull-requests: write` only for the comment; with `comment: false` it needs no write permission at all. Declare permissions per job and set `permissions: {}` at the top of the workflow.
- **Text from the diff is inert.** File names, package names, test ids and code quoted in the comment are rendered as code spans or escaped text, so a pull request cannot inject links, images, HTML or @mentions into the report. Annotations and log lines escape workflow command syntax.
- **Its own comment only.** RSP updates only a comment written by a bot that starts with its marker; a marker pasted by someone else is ignored.
- **Pull request code runs only when you ask.** Without `test-command`, RSP never executes code from the repository; it reads git objects. With it, see [In the GitHub Action](#in-the-github-action): no tokens in the environment, no step files, workflow commands off, refused on `pull_request_target`, symbolic links ignored when collecting reports.
- **No network in the rules.** Only the comment step talks to the GitHub API, with the token you give it.
- **Supply chain.** The Action is a single bundled file (`action-dist/index.js`) that CI rebuilds and compares on every change, with one runtime dependency (`smol-toml`). Pin the Action by commit SHA. The repository's own workflows pin every action by SHA, run with read-only permissions by default, verify npm registry signatures and are scanned by CodeQL; Dependabot keeps them current.

Report vulnerabilities privately as described in [SECURITY.md](../SECURITY.md).
