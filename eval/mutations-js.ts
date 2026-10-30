// Labelled changes applied to eval/project-js, a small Express service in
// TypeScript. Same conventions as eval/mutations.ts.
import { benign, CD, DEP, ENV, IF, LOCK, type Mutation, replace, risky } from "./mutations.js";

export const MUTATIONS_JS: Mutation[] = [
  risky("it-skip", [CD], "Skip a failing test with it.skip", (f) =>
    replace(f, "test/store.test.ts", '  it("rejects removing more than is left"', '  it.skip("rejects removing more than is left"')),
  risky("describe-only", [CD], "Focus one suite with describe.only", (f) =>
    replace(f, "test/server.test.ts", 'describe("createApp"', 'describe.only("createApp"')),
  risky("ts-ignore", [CD], "Silence a type error with @ts-ignore", (f) =>
    replace(f, "src/server.ts", "    const quantity = Number(", "    // @ts-ignore\n    const quantity = Number(")),
  risky("ts-expect-error-in-src", [CD], "Silence a type error with @ts-expect-error outside tests", (f) =>
    replace(f, "src/prices.ts", "  const body = (await res.json())", "  // @ts-expect-error the API is untyped\n  const body = (await res.json())")),
  risky("eslint-disable-line", [CD], "Disable an ESLint rule inline", (f) =>
    replace(f, "src/store.ts", "    if (!item) throw", "    // eslint-disable-next-line eqeqeq\n    if (!item) throw")),
  risky("eslint-rule-off", [CD], "Turn an ESLint rule off in the config", (f) =>
    replace(f, "eslint.config.js", '"no-unused-vars": "error"', '"no-unused-vars": "off"')),
  risky("strict-off", [CD], "Turn TypeScript strict mode off", (f) =>
    replace(f, "tsconfig.json", '"strict": true', '"strict": false')),
  risky("lint-script-neutered", [CD], "Make the lint script do nothing", (f) =>
    replace(f, "package.json", '"lint": "eslint src test"', '"lint": "true"')),
  risky("ci-typecheck-removed", [CD], "Remove the type-check step from CI", (f) =>
    replace(f, ".github/workflows/ci.yml", "      - run: npx tsc --noEmit\n", "")),
  risky("ci-test-or-true", [CD], "Let the test step pass whatever happens", (f) =>
    replace(f, ".github/workflows/ci.yml", "      - run: npm test\n", "      - run: npm test || true\n")),
  risky("test-file-deleted", [CD], "Delete a test file", (f) => {
    f.delete("test/server.test.ts");
  }),
  risky("assertion-removed", [CD], "Drop an assertion from a test", (f) =>
    replace(f, "test/store.test.ts", '    expect(store.get("pear")).toEqual(item);\n', "")),
  risky("undeclared-import", [DEP], "Import pino without declaring it", (f) =>
    replace(f, "src/server.ts", 'import express from "express";\n', 'import express from "express";\nimport pino from "pino";\n')),
  risky("undeclared-scoped-require", [DEP], "Require a scoped package without declaring it", (f) =>
    replace(f, "src/prices.ts", "const BASE_URL", 'const { Redis } = require("@upstash/redis");\n\nconst BASE_URL')),
  risky("dependency-not-locked", [LOCK], "Add pino to package.json by hand and import it", (f) => {
    replace(f, "package.json", '    "express": "^5.1.0",\n', '    "express": "^5.1.0",\n    "pino": "^9.7.0",\n');
    replace(f, "src/server.ts", 'import express from "express";\n', 'import express from "express";\nimport pino from "pino";\n');
  }),
  risky("range-changed-not-locked", [LOCK], "Change the zod range in package.json only", (f) =>
    replace(f, "package.json", '"zod": "^3.25.0"', '"zod": "^4.0.0"')),
  risky("dependency-removed-still-locked", [LOCK], "Remove eslint from package.json but not from the lockfile", (f) =>
    replace(f, "package.json", '    "eslint": "^9.30.0",\n', "")),
  risky("env-process-env", [ENV], "Read PRICE_API_KEY with process.env", (f) =>
    replace(f, "src/prices.ts", "  const res = await fetch(", "  const key = process.env.PRICE_API_KEY;\n  const res = await fetch(")),
  risky("env-destructured", [ENV], "Destructure LOG_LEVEL from process.env", (f) =>
    replace(f, "src/server.ts", "export function createApp", "const { LOG_LEVEL } = process.env;\n\nexport function createApp")),
  risky("param-added-untested", [IF], "Add a parameter to an exported function without touching tests", (f) =>
    replace(f, "src/prices.ts", 'export async function fetchPrice(sku: string, currency = "EUR")', 'export async function fetchPrice(sku: string, currency = "EUR", timeoutMs = 5000)')),

  benign("dependency-declared", "Add pino to package.json and the lockfile and import it", (f) => {
    replace(f, "package.json", '    "express": "^5.1.0",\n', '    "express": "^5.1.0",\n    "pino": "^9.7.0",\n');
    replace(f, "package-lock.json", '        "express": "^5.1.0",\n', '        "express": "^5.1.0",\n        "pino": "^9.7.0",\n');
    replace(f, "src/server.ts", 'import express from "express";\n', 'import express from "express";\nimport pino from "pino";\n');
  }),
  benign("dependency-bumped", "Bump vitest in package.json and the lockfile, as Dependabot does", (f) => {
    replace(f, "package.json", '"vitest": "^3.2.4"', '"vitest": "^3.2.5"');
    replace(f, "package-lock.json", '        "vitest": "^3.2.4"', '        "vitest": "^3.2.5"');
    replace(f, "package-lock.json", '"version": "3.2.4",\n      "resolved": "https://registry.npmjs.org/vitest/-/vitest-3.2.4.tgz"', '"version": "3.2.5",\n      "resolved": "https://registry.npmjs.org/vitest/-/vitest-3.2.5.tgz"');
  }),
  benign("node-builtins", "Import Node built-ins", (f) =>
    replace(f, "src/prices.ts", "const BASE_URL", 'import { readFile } from "node:fs/promises";\nimport path from "path";\n\nconst BASE_URL')),
  benign("relative-import", "Import a module of the project itself", (f) =>
    replace(f, "src/prices.ts", "const BASE_URL", 'import type { Item } from "./store.js";\n\nconst BASE_URL')),
  benign("env-documented", "Read PRICE_API_KEY and add it to .env.example", (f) => {
    replace(f, ".env.example", "PRICE_API_URL=", "PRICE_API_KEY=\nPRICE_API_URL=");
    replace(f, "src/prices.ts", "  const res = await fetch(", "  const key = process.env.PRICE_API_KEY;\n  const res = await fetch(");
  }),
  benign("node-env", "Read NODE_ENV", (f) =>
    replace(f, "src/server.ts", "export function createApp", 'const production = process.env.NODE_ENV === "production";\n\nexport function createApp')),
  benign("ts-expect-error-in-test", "Use @ts-expect-error as an assertion in a test", (f) =>
    replace(f, "test/store.test.ts", '  it("totals quantities"', '  it("rejects a missing name at compile time", () => {\n    // @ts-expect-error name is required\n    expect(() => new Store().add("x")).not.toThrow();\n  });\n\n  it("totals quantities"')),
  benign("new-test", "Add a test with assertions", (f) =>
    replace(f, "test/store.test.ts", '  it("totals quantities"', '  it("returns undefined for a missing sku", () => {\n    expect(new Store().get("kiwi")).toBeUndefined();\n  });\n\n  it("totals quantities"')),
  benign("ci-step-added", "Add a build step to CI", (f) =>
    replace(f, ".github/workflows/ci.yml", "      - run: npm test\n", "      - run: npm test\n      - run: npm run build\n")),
  benign("eslint-replaced-by-oxlint", "Replace eslint with oxlint in the lint script", (f) =>
    replace(f, "package.json", '"lint": "eslint src test"', '"lint": "oxlint src test"')),
  benign("param-added-with-test", "Add a parameter to totalQuantity and a test that uses it", (f) => {
    replace(f, "src/store.ts", "export function totalQuantity(items: Item[]): number {\n  return items.reduce((sum, item) => sum + item.quantity, 0);", "export function totalQuantity(items: Item[], min = 0): number {\n  return items.filter((i) => i.quantity >= min).reduce((sum, item) => sum + item.quantity, 0);");
    replace(f, "test/store.test.ts", "  it(\"totals quantities\", () => {\n", "  it(\"totals quantities\", () => {\n    expect(totalQuantity([{ sku: \"a\", name: \"A\", quantity: 2 }], 3)).toBe(0);\n");
  }),
  benign("positional-param-renamed", "Rename a positional parameter of an exported function", (f) =>
    replace(f, "src/prices.ts", 'export async function fetchPrice(sku: string, currency = "EUR"): Promise<number> {\n  const res = await fetch(`${BASE_URL}/prices/${encodeURIComponent(sku)}', 'export async function fetchPrice(code: string, currency = "EUR"): Promise<number> {\n  const res = await fetch(`${BASE_URL}/prices/${encodeURIComponent(code)}')),
  benign("types-only", "Change only a parameter type", (f) =>
    replace(f, "src/store.ts", "export function totalQuantity(items: Item[])", "export function totalQuantity(items: readonly Item[])")),
  benign("route-added", "Add a new route", (f) =>
    replace(f, "src/server.ts", "  return app;\n", '  app.get("/health", (_req, res) => {\n    res.json({ ok: true });\n  });\n\n  return app;\n')),
];
