# Changelog

All notable changes to RSP are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). Each release lists new rules and keys, rules whose version changed, and false facts that were fixed, because a changed rule version can change the findings on the same commits.

The section of a version is the body of its GitHub Release.

## [Unreleased]

### Added

- New rule `deps/lockfile` 0.1.0: dependencies added, changed or removed in `package.json`, `pyproject.toml` or `Pipfile` that the lockfile next to them does not match (`package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `uv.lock`, `poetry.lock`, `pdm.lock`, `Pipfile.lock`).
- `deps/undeclared` 0.4.0 reads more Python manifests: files included from requirements files with `-r` or `-c` whatever their name, `Pipfile`, and conda `environment.yml`. More manifests can only remove findings.
- The sample Python project in the evaluation has a `uv.lock`; both sample projects have lockfile mutations.
- New rule `interface/removed-still-used` 0.1.0: top-level Python names and JavaScript/TypeScript exports that the diff removes while another file still imports them.
- New rule `interface/route-removed` 0.1.0: HTTP routes with a literal path (Flask, FastAPI, Django, Express, Fastify and similar routers) removed or given another method, and declared by no file at head.
- `interface/untested-change` 0.2.0 also compares the constructors of dataclasses, attrs classes and Pydantic models, constructors and public methods of exported TypeScript classes, fields of exported TypeScript interfaces and object types (removed, added as required, made required), and return annotations. Keys can now be type names.

- `CHANGELOG.md`, and a test that keeps it in step with the version in `package.json`.
- Release workflow: pushing a tag `vX.Y.Z` on `main` creates the GitHub Release from this file and moves the major tag `v0` to the same commit.
- End-to-end tests of the Action on this repository's own pull requests: the Action run from `action.yml`, its report compared with the CLI, and the environment of `test-command` checked on a real runner.
- `docs/WRITING-RULES.md`, a guide for writing a new rule, with an example rule that a test runs.
- Golden fixtures can carry JUnit reports in `reports/`, so `tests/delta` is tested like the other rules.
- A sample JavaScript project in the evaluation, `eval/project-js/`, with its own labelled mutations.

## [0.4.0] - 2026-10-21

### Changed

- The project is named **RSP: Reproducible Shortcut Patrol**. The command, the package and the configuration file keep the lower-case `rsp`.

### Security

- Text from the diff can no longer inject Markdown, HTML, links or mentions into the pull request comment: rule messages quote names as code spans and the report escapes everything else. Unmatched backtick runs become HTML entities.
- The Action edits only a comment written by a bot that starts with its marker.
- `test-command` runs without the Action inputs (which hold the token), the Actions runtime tokens or the step files in its environment, with workflow commands stopped. It is refused on `pull_request_target`, a token left in `.git/config` produces a warning, and symbolic links are skipped when collecting reports.
- The repository's workflows set `permissions: {}`, pin actions by SHA, check out with `persist-credentials: false`, install with `npm ci --ignore-scripts`, verify registry signatures and run CodeQL. `SECURITY.md` describes how to report a vulnerability.

## [0.3.0] - 2026-10-21

### Added

- Configuration in `.rsp.toml`, read from the base commit: global `exclude`, and per rule `enabled`, `allow` and `exclude`. Unknown keys, rules and pattern ids are errors. Every finding has a `key` that `allow` matches; `--no-config` ignores the file.
- New rule `interface/untested-change` 0.1.0: public functions whose parameters changed while no test changed by the diff mentions them.
- New rule `tests/delta` 0.1.0: test results at base and head compared from JUnit reports (`--junit-base`, `--junit-head`). The Action runs a `test-command` at both commits and reruns head to clear flaky failures (`test-retries`).
- Evaluation on SWE-bench Lite: the human fix of each task and the patches of three agents (`eval/swe-bench.ts`, `eval/SWE_BENCH.md`).

### Changed

- `checks/disabled` treats `node --test`, `deno test` and `bun test` as test runs.

### Fixed

False facts found on real history and on SWE-bench patches:

- Python skip markers, suppressions and imports inside strings were reported; they are text.
- `setup.py` dependency lists built in variables were not read; when they are computed from another module the rule now stays silent.
- `pytest` imported by test files was reported as undeclared; it is the test runner.
- A method defined twice without `@overload` was compared with the wrong definition; properties were treated as interfaces.
- A backslash at the end of a line inside a string shifted line numbers in the string scanners.
- Typed overloads with the same parameters as the implementation, JavaScript parameter comments and a default of `undefined` were reported as interface changes.

## [0.2.0] - 2026-10-21

### Added

- JavaScript and TypeScript in every rule:
  - `deps/undeclared`: `import`, `export ... from` and `require()` checked against every `package.json` between the file and the root, with workspaces, `@types/` packages and tsconfig path aliases.
  - `env/missing-example`: `process.env`, `import.meta.env`, `Deno.env.get` and `Bun.env`.
  - `checks/disabled`: `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, `biome-ignore`, coverage ignores, skipped and focused tests, `package.json` scripts that stop running a check, TypeScript strict options off, ESLint rules off, `|| exit 0`.
- `--exclude` on the command line.
- Real history on JavaScript projects (`eval/REAL_HISTORY_JS.md`).

### Fixed

- Destructuring from `process.env` inside a string literal was reported.
- A regular expression containing a quote inside a `${...}` expression made the template literal scanner lose track of the file.

## [0.1.0] - 2026-10-21

### Added

- Rules for Python:
  - `deps/undeclared`: new imports not declared in `pyproject.toml` (PEP 621, PEP 735, Poetry, PDM, uv), requirements files, `setup.cfg` or `setup.py`.
  - `env/missing-example`: environment variables read by literal name and missing from the example env file.
  - `checks/disabled`: skip and xfail markers, suppressions, CI lines running a checker removed, `continue-on-error`, `|| true`, `if: false`, pytest `--deselect` and `--ignore`, lower coverage thresholds, fewer assertions across changed tests.
- The CLI, `rsp check`, with JSON and Markdown output.
- The GitHub Action: sticky pull request comment, job summary, annotations, outputs, `fail-on` and `exclude`.
- Golden fixtures, labelled mutations on a sample Python project (`eval/RESULTS.md`) and real history on five Python projects (`eval/REAL_HISTORY.md`).

### Fixed

- YAML keys and flow mappings in workflows, such as matrix entries naming tox environments, are no longer read as CI commands.

[Unreleased]: https://github.com/fedeveloper/rsp/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/fedeveloper/rsp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/fedeveloper/rsp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/fedeveloper/rsp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/fedeveloper/rsp/releases/tag/v0.1.0
