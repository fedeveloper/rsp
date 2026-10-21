// Labelled changes applied to eval/project. A "risky" mutation lists the rules
// that must report it; a "benign" one must produce no findings at all.

export type Files = Map<string, string>;

export interface Mutation {
  id: string;
  kind: "risky" | "benign";
  description: string;
  expect: string[];
  apply(files: Files): void;
}

export const CD = "checks/disabled";
export const DEP = "deps/undeclared";
export const ENV = "env/missing-example";

/** Replaces exactly one occurrence, so a mutation fails loudly if the project drifts. */
export function replace(files: Files, path: string, from: string, to: string): void {
  const text = files.get(path);
  if (text === undefined) throw new Error(`${path} not in project`);
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`${path}: expected one occurrence of ${JSON.stringify(from)}`);
  files.set(path, text.slice(0, at) + to + text.slice(at + from.length));
}

export const risky = (id: string, expect: string[], description: string, apply: (f: Files) => void): Mutation => ({
  id, kind: "risky", description, expect, apply,
});
export const benign = (id: string, description: string, apply: (f: Files) => void): Mutation => ({
  id, kind: "benign", description, expect: [], apply,
});

export const MUTATIONS: Mutation[] = [
  risky("skip-marker", [CD], "Skip a failing test with @pytest.mark.skip", (f) =>
    replace(f, "tests/test_store.py", "def test_remove_rejects_overdraw", '@pytest.mark.skip(reason="flaky")\ndef test_remove_rejects_overdraw')),
  risky("xfail-marker", [CD], "Mark a test as expected to fail", (f) =>
    replace(f, "tests/test_store.py", "def test_add_accumulates_quantity", "@pytest.mark.xfail\ndef test_add_accumulates_quantity")),
  risky("skip-call", [CD], "Call pytest.skip() at the start of a test", (f) =>
    replace(f, "tests/test_store.py", "    store = Store()\n    store.add(\"pear\", 4)", '    pytest.skip("todo")\n    store = Store()\n    store.add("pear", 4)')),
  risky("noqa", [CD], "Silence a lint error with # noqa", (f) =>
    replace(f, "inventory/client.py", "import requests\n", "import requests\nimport json  # noqa: F401\n")),
  risky("type-ignore", [CD], "Silence a type error with # type: ignore", (f) =>
    replace(f, "inventory/store.py", "        item = self._items[sku]\n", "        item = self._items[sku]  # type: ignore[index]\n")),
  risky("pragma-no-cover", [CD], "Exclude a branch from coverage", (f) =>
    replace(f, "inventory/store.py", "        if quantity > item.quantity:\n", "        if quantity > item.quantity:  # pragma: no cover\n")),
  risky("nosec", [CD], "Silence a security linter with # nosec", (f) =>
    replace(f, "inventory/client.py", "        timeout=10,\n", "        timeout=10,\n        verify=False,  # nosec\n")),
  risky("pylint-disable", [CD], "Disable a pylint check inline", (f) =>
    replace(f, "inventory/store.py", "    def get(self, sku: str) -> Item | None:\n", "    def get(self, sku: str) -> Item | None:  # pylint: disable=missing-function-docstring\n")),
  risky("test-file-deleted", [CD], "Delete a test file", (f) => {
    f.delete("tests/test_config.py");
  }),
  risky("assertion-removed", [CD], "Drop an assertion from a test", (f) =>
    replace(f, "tests/test_store.py", "    assert store.get(\"pear\") == item\n", "")),
  risky("ci-step-removed", [CD], "Remove the type-check step from CI", (f) =>
    replace(f, ".github/workflows/ci.yml", "      - run: uv run mypy inventory\n", "")),
  risky("ci-or-true", [CD], "Let the test step pass whatever happens", (f) =>
    replace(f, ".github/workflows/ci.yml", "      - run: uv run pytest\n", "      - run: uv run pytest || true\n")),
  risky("ci-continue-on-error", [CD], "Allow the lint step to fail", (f) =>
    replace(f, ".github/workflows/ci.yml", "      - run: uv run ruff check .\n", "      - run: uv run ruff check .\n        continue-on-error: true\n")),
  risky("coverage-lowered", [CD], "Lower the coverage threshold from 85 to 60", (f) =>
    replace(f, "pyproject.toml", "fail_under = 85", "fail_under = 60")),
  risky("pytest-deselect", [CD], "Deselect a test in pytest options", (f) =>
    replace(f, "pyproject.toml", 'addopts = "-q --cov=inventory"', 'addopts = "-q --cov=inventory --deselect tests/test_store.py::test_remove_rejects_overdraw"')),
  risky("undeclared-httpx", [DEP], "Import httpx without declaring it", (f) =>
    replace(f, "inventory/client.py", "import requests\n", "import httpx\nimport requests\n")),
  risky("undeclared-from-import", [DEP], "Import tenacity with from-import without declaring it", (f) =>
    replace(f, "inventory/client.py", "import requests\n", "import requests\nfrom tenacity import retry\n")),
  risky("undeclared-renamed-dist", [DEP], "Import yaml (PyYAML) without declaring it", (f) =>
    replace(f, "inventory/config.py", "import os\n", "import os\n\nimport yaml\n")),
  risky("undeclared-test-plugin", [DEP], "Use pytest_mock in tests without declaring it", (f) =>
    replace(f, "tests/test_config.py", "from inventory.config", "import pytest_mock\n\nfrom inventory.config")),
  risky("env-getenv", [ENV], "Read REDIS_URL with os.getenv", (f) =>
    replace(f, "inventory/config.py", "        api_key=os.environ[\"API_KEY\"],\n", "        api_key=os.environ[\"API_KEY\"],\n        redis_url=os.getenv(\"REDIS_URL\"),\n")),
  risky("env-subscript", [ENV], "Read SENTRY_DSN with os.environ[...]", (f) =>
    replace(f, "inventory/config.py", "def load_settings", "SENTRY_DSN = os.environ[\"SENTRY_DSN\"]\n\n\ndef load_settings")),
  risky("env-get", [ENV], "Read FEATURE_FLAG with os.environ.get", (f) => {
    replace(f, "inventory/client.py", "import requests\n", "import os\n\nimport requests\n");
    replace(f, "inventory/client.py", "    settings = load_settings()\n", "    settings = load_settings()\n    beta = os.environ.get(\"FEATURE_FLAG\", \"0\")\n");
  }),
  risky("dep-and-env", [DEP, ENV], "Import httpx and read HTTPX_TIMEOUT, neither declared", (f) =>
    replace(f, "inventory/client.py", "import requests\n", "import os\n\nimport httpx\nimport requests\n\nTIMEOUT = float(os.getenv(\"HTTPX_TIMEOUT\", \"10\"))\n")),

  benign("rename-function", "Rename a function and its callers", (f) => {
    replace(f, "inventory/config.py", "def load_settings", "def read_settings");
    replace(f, "inventory/client.py", "from inventory.config import load_settings", "from inventory.config import read_settings");
    replace(f, "inventory/client.py", "settings = load_settings()", "settings = read_settings()");
    replace(f, "tests/test_config.py", "from inventory.config import load_settings", "from inventory.config import read_settings");
    replace(f, "tests/test_config.py", "assert load_settings()", "assert read_settings()");
  }),
  benign("new-test", "Add a test with assertions", (f) =>
    replace(f, "tests/test_store.py", "def test_remove_rejects_overdraw", "def test_get_missing_returns_none():\n    assert Store().get(\"kiwi\") is None\n\n\ndef test_remove_rejects_overdraw")),
  benign("stdlib-imports", "Import standard library modules", (f) =>
    replace(f, "inventory/client.py", "import requests\n", "import json\nimport logging\nfrom pathlib import Path\n\nimport requests\n")),
  benign("local-import", "Import a module of the project itself", (f) =>
    replace(f, "inventory/client.py", "from inventory.config import load_settings\n", "from inventory.config import load_settings\nfrom inventory.store import Store\nfrom . import store\n")),
  benign("dependency-declared", "Add httpx to pyproject and import it", (f) => {
    replace(f, "pyproject.toml", '    "pydantic>=2.6",\n', '    "pydantic>=2.6",\n    "httpx>=0.27",\n');
    replace(f, "inventory/client.py", "import requests\n", "import httpx\nimport requests\n");
  }),
  benign("env-documented", "Read REDIS_URL and add it to .env.example", (f) => {
    replace(f, ".env.example", "API_KEY=\n", "API_KEY=\nREDIS_URL=redis://localhost:6379\n");
    replace(f, "inventory/config.py", "def load_settings", "REDIS_URL = os.getenv(\"REDIS_URL\")\n\n\ndef load_settings");
  }),
  benign("env-already-documented", "Read DATABASE_URL in a new place", (f) =>
    replace(f, "inventory/client.py", "import requests\n", "import os\n\nimport requests\n\nDB = os.environ.get(\"DATABASE_URL\")\n")),
  benign("move-suppressed-line", "Move a function that already has # type: ignore", (f) => {
    const store = f.get("inventory/store.py")!;
    const legacy = store.slice(store.indexOf("\n\ndef legacy_total"));
    f.set("inventory/store.py", store.replace(legacy, "\n").replace("\n\nclass Item(BaseModel)", `${legacy.trimEnd()}\n\n\nclass Item(BaseModel)`));
  }),
  benign("docstring", "Add docstrings", (f) =>
    replace(f, "inventory/store.py", "class Store:\n", "class Store:\n    \"\"\"In-memory stock levels by SKU.\"\"\"\n\n")),
  benign("ci-step-added", "Add a format check to CI", (f) =>
    replace(f, ".github/workflows/ci.yml", "      - run: uv run ruff check .\n", "      - run: uv run ruff check .\n      - run: uv run ruff format --check .\n")),
  benign("ci-step-edited", "Run pytest with extra flags", (f) =>
    replace(f, ".github/workflows/ci.yml", "      - run: uv run pytest\n", "      - run: uv run pytest -x --maxfail=1\n")),
  benign("coverage-raised", "Raise the coverage threshold to 90", (f) =>
    replace(f, "pyproject.toml", "fail_under = 85", "fail_under = 90")),
  benign("type-checking-import", "Import a stub package only for type checking", (f) =>
    replace(f, "inventory/client.py", "import requests\n", "from typing import TYPE_CHECKING\n\nimport requests\n\nif TYPE_CHECKING:\n    from mypy_boto3_s3 import S3Client\n")),
  benign("optional-import", "Use ujson when available, json otherwise", (f) =>
    replace(f, "inventory/client.py", "import requests\n", "try:\n    import ujson as json\nexcept ImportError:\n    import json\n\nimport requests\n")),
  benign("readme-mentions", "Document suppressions in the README", (f) =>
    replace(f, "README.md", "evaluation corpus.\n", "evaluation corpus.\n\nAvoid `# noqa` and `@pytest.mark.skip`; read config with `os.getenv(\"X\")`.\n")),
  benign("test-renamed", "Rename a test without changing its assertions", (f) =>
    replace(f, "tests/test_store.py", "def test_add_accumulates_quantity", "def test_add_sums_quantities")),
];
