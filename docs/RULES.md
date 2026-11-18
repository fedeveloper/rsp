# Rules

RSP has nine rules. This page describes what each one reports, the **key** of its findings (what you name in `.rsp.toml` to accept that kind of finding, see [Configuration](GUIDE.md#configuration-rsptoml)) and the cases where it stays silent on purpose. `rsp --list-rules` prints the same list.

Back to the [README](../README.md) · [User guide](GUIDE.md) · [How RSP is validated](VALIDATION.md)

Each rule looks at the diff between the merge-base of the pull request and its head.

## `checks/disabled`

Checks that were removed or switched off.

| What | Example | Key |
| --- | --- | --- |
| pytest skip and xfail markers | `@pytest.mark.skip(reason="flaky")` | `pytest-skip`, `pytest-xfail` |
| `pytest.skip()` called inside a test | `pytest.skip("todo")` | `pytest-skip-call` |
| unittest skips | `@unittest.skip`, `@unittest.skipIf`, `@unittest.expectedFailure` | `unittest-skip` |
| JS/TS skipped or focused tests | `it.skip`, `test.skipIf`, `xit`, `describe.only` | `test-skip`, `test-only` |
| Go tests skipped (in `_test.go` files) | `t.Skip("flaky")`, `t.SkipNow()` | `go-test-skip` |
| Python suppressions | `# noqa`, `# type: ignore`, `# pylint: disable`, `# nosec` | `noqa`, `type-ignore`, `pylint-disable`, `nosec` |
| Coverage exclusions | `# pragma: no cover`, `/* istanbul ignore next */`, `c8 ignore`, `v8 ignore` | `coverage-exclusion` |
| JS/TS suppressions | `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, `biome-ignore` | `eslint-disable`, `ts-ignore`, `ts-nocheck`, `ts-expect-error`, `biome-ignore` |
| Go suppressions | `//nolint`, `//lint:ignore`, `// #nosec` | `nolint`, `lint-ignore`, `nosec` |
| Test files deleted | `tests/test_store.py` removed | `test-file-deleted` |
| Fewer assertions across the changed tests | 12 `assert` before, 9 after | `fewer-assertions` |
| A CI line running a checker removed | `- run: mypy src` or `- run: golangci-lint run` deleted | `ci-check-removed` |
| CI steps allowed to fail | `continue-on-error: true`, `pytest \|\| true`, `\|\| exit 0`, `if: false` | `continue-on-error`, `or-true`, `or-exit-0`, `if-false` |
| pytest told to skip tests | `--deselect`, `--ignore` in `addopts` | `pytest-exclude-option` |
| Lower coverage threshold | `fail_under = 85` → `60` | `coverage-threshold-lowered` |
| A package.json script stops running a check | `"lint": "eslint ."` → `"lint": "true"` | `script-check-removed` |
| TypeScript strictness turned off | `"strict": false` in tsconfig | `ts-strict-off` |
| ESLint rules turned off | `"no-unused-vars": "off"` | `eslint-rule-off` |

It deliberately ignores lines moved between files, tests moved to another file, a checker replaced by one of the same kind (eslint by oxlint, jest by vitest, flake8 by ruff), `@ts-expect-error` inside test files (where it is the assertion), and helper files that live in test folders but contain no tests. Go test files are not counted for fewer assertions, because Go tests assert through `t.Error`, testify or helpers of their own.

## `deps/undeclared`

Imports added by the diff whose package is not declared in a dependency manifest. The key is the imported module (Python), package (JavaScript) or import path (Go).

- **Python** imports are checked against `pyproject.toml` (PEP 621 dependencies and optional dependencies, PEP 735 dependency groups, Poetry, PDM and uv), `requirements*.txt` and any file they include with `-r` or `-c`, `Pipfile`, conda `environment.yml`, `setup.cfg` and literal lists in `setup.py`. Import names are mapped to distribution names where they differ (`yaml` is `PyYAML`, `sklearn` is `scikit-learn`).
- **JavaScript/TypeScript** `import`, `export ... from` and `require()` are checked against every `package.json` between the file and the repository root, including `@types/` packages.
- **Go** import paths are checked against the `require` and `replace` directives of the nearest `go.mod`; a subpackage of a required module is covered by it.

It ignores the standard library and Node built-ins, the repository's own modules, workspace packages and Go modules, `vendor/` and `testdata/`, relative imports, tsconfig path aliases, imports under `if TYPE_CHECKING:` or inside `try`/`except` (Python) or `try`/`catch` (JS), dynamic `import()`, code inside strings and template literals, and repositories with no manifest at all.

## `deps/lockfile`

Dependencies added, changed or removed in a manifest by the diff that the lockfile next to it does not match. This is what happens when a dependency is added to `package.json` or `pyproject.toml` by hand instead of through the package manager. The key is the package name.

| Lockfile | Compared with the manifest |
| --- | --- |
| `package-lock.json`, `npm-shrinkwrap.json` (v2, v3) | the lockfile's copy of the package's dependency ranges (`packages[""]`, or the workspace's entry) |
| `pnpm-lock.yaml` (v6, v9) | `importers` and their `specifier`s |
| `yarn.lock` (classic and Berry) | an entry for `name@range` |
| `uv.lock` | the project's `requires-dist` and `requires-dev` |
| `poetry.lock`, `pdm.lock`, `Pipfile.lock` | the package is locked at all |
| `go.sum` | a line for the required module at the required version |

```text
deps/lockfile  package.json:14  Declares `zod` `^3.23.0` in dependencies; package-lock.json does not list it
deps/lockfile  package.json:9   Declares `express` `^5.1.0` in dependencies; package-lock.json records `^4.18.0`
deps/lockfile  pyproject.toml   Removes `pydantic` from pyproject.toml; uv.lock still lists it
```

The rule only looks at lockfiles that existed at base, in the manifest's directory or the nearest one above it, and that it can read. It stays silent for `package-lock.json` v1, for a directory with two kinds of lockfile, for local ranges (`workspace:`, `file:`, git URLs), for manifests that were only reformatted, and for removals from lockfiles that list every installed package rather than the project's own requirements (Yarn, Poetry, PDM, Pipfile).

## `env/missing-example`

Environment variables read by literal name in added code that are missing from the repository's example env file (`.env.example`, `.env.sample`, `.env.local.example`, `example.env`, ...). The key is the variable name.

- **Python**: `os.getenv("X")`, `os.environ["X"]`, `os.environ.get("X")`.
- **JavaScript/TypeScript**: `process.env.X`, `process.env["X"]`, destructuring from `process.env`, `import.meta.env.X`, `Deno.env.get("X")`, `Bun.env.X`.
- **Go**: `os.Getenv("X")`, `os.LookupEnv("X")`, `syscall.Getenv("X")`.

It ignores variables set by the OS, Node, Vite or CI (`HOME`, `NODE_ENV`, `import.meta.env.MODE`, `GITHUB_*` and similar), writes to the environment, reads moved from elsewhere in the repository, and repositories without an example file: no example file means there is no convention to keep up.

## `interface/removed-still-used`

Names that the diff removes from a module while another file still imports them by name at head: the rename or deletion whose callers were left behind. The key is the module and the name, such as `app/config.py:load_settings`.

- **Python**: top-level functions, classes and assignments, imported with `from module import name` (relative imports and the `src/` layout included).
- **JavaScript/TypeScript**: exports, including the default export, imported with `import { name }`, `import name` or re-exported with `export { name } from` through a relative path.

```text
interface/removed-still-used  app/views.py:3  Imports `load_settings` from `app/config.py`, which no longer defines it
```

It stays silent when the name is still mentioned anywhere in the module (it may be re-exported or assigned), for modules that can define names dynamically (`__getattr__`, `import *`, `globals()`, `export *`, CommonJS exports), for submodules of a package, for imports guarded by `try` or `TYPE_CHECKING`, and for imports that resolve to more than one file.

## `interface/route-removed`

HTTP routes declared with a literal path that the diff removes, or whose method it changes, and that no file declares at head. The key is the method and path, such as `GET /items/:id`.

- **Python**: Flask and FastAPI decorators (`@app.route` with `methods`, `@router.get`, ...), Django `path()` and `re_path()` in `urls.py`.
- **JavaScript/TypeScript**: `app.get("/x", ...)` and the other methods on receivers named like a server or router (`app`, `router`, `server`, `fastify`, `api`, `*Router`, ...), so client calls such as `axios.get("/x")` are not routes.

```text
interface/route-removed  src/server.ts  Removed route `DELETE /items/:sku`; no file declares it at head
```

Renaming a path parameter is not a change, and a route moved to another file or router is still served. Routes in tests, examples and docs are left out, and so are paths built at run time.

## `interface/untested-change`

Public interfaces that changed while no test file changed by the diff mentions them. The key is the function or type name, such as `load_settings`, `Store.add` or `Settings`.

- **Parameters**: a parameter added or removed, a new or changed default, a different order, or a rename where callers can pass the parameter by name. For Python this covers public top-level functions, methods of public classes, and the constructors that dataclasses, attrs classes and Pydantic models get from their fields; for JavaScript/TypeScript, exported functions, exported arrow functions, and constructors and public methods of exported classes.
- **Fields of TypeScript types**: fields of exported interfaces and object type aliases removed, added as required, or made required. Adding an optional field is not reported.
- **Return types**: a return annotation changed, after normalizing spellings that mean the same (`List[str]` and `list[str]`, `Optional[int]` and `int | None`, union order). Adding or removing an annotation is not a change.

```text
interface/untested-change  src/api.py:4       Return type of `load`: changed `dict` to `list`; no test changed by the diff mentions it
interface/untested-change  src/config.ts:1    Fields of `Settings`: removed `port`; added required `timeout`; no test changed by the diff mentions it
```

It ignores changes to parameter annotations and formatting only, renames of JavaScript positional parameters (callers cannot see them), private names (`_helper`), typed overloads that add no new parameter list, return types of overloaded functions, fields removed from interfaces that extend another one, types with index signatures, functions and types that a changed test mentions, files that are themselves tests, and repositories with no tests at all.

## `tests/delta`

Differences between the test results at base and at head, read from JUnit XML reports. It runs only when reports are given; see [Test results before and after](GUIDE.md#test-results-before-and-after). The key is the test id, `classname::name` as in the report, or `no-tests`.

- A test that passed at base and fails at head.
- A test that ran at base and is skipped at head.
- A test that ran at base and is missing at head, reported only when the head suite is smaller than the base one, so renamed and moved tests are not reported as missing.
- No test results at all at head when there were some at base.

Tests that already failed at base are not reported: they are not caused by the pull request. Tests that failed and also passed at head, on a rerun or through the runner's own retries (pytest-rerunfailures, Maven Surefire), count as passed and are listed under the table as flaky, not as findings. When a head report was cut off while it was written, missing tests are not reported, and the report says so.

## `tests/uncovered-change`

Added lines that the coverage report of the tests at head measures and that did not run, one fact per file. It runs only when coverage reports are given, so it is off unless you ask for it; see [Coverage of added lines](GUIDE.md#coverage-of-added-lines). The key is the file path.

```text
tests/uncovered-change  src/billing.py:7  1 of the 4 added lines of `src/billing.py` that the coverage report measures did not run in the tests at head
```

It reads LCOV and Cobertura XML. Lines the report does not measure, comments, TypeScript type-only declarations and lines moved from elsewhere in the diff are not counted, and files the report does not mention are not reported.
