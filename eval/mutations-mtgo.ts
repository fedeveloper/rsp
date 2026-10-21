// Labelled changes applied to a real application: MTGO Collection Tracker
// (Node, Express, React, Vite), at a pinned commit. The risky ones are the kind
// of change a coding assistant makes to get something working; the benign ones
// are ordinary work on the same code.
import { benign, CD, DEP, ENV, type Files, IF, type Mutation, replace, risky } from "./mutations.js";

export const MTGO_REPO = "https://github.com/fedeveloper/MTGO-Collection-Tracker";
export const MTGO_COMMIT = "a70a02cae51ebd50eed5faf162e941e002987997";

/** Replaces every occurrence, failing if there is none. */
function replaceAll(files: Files, path: string, from: string, to: string): void {
  const text = files.get(path);
  if (!text?.includes(from)) throw new Error(`${path}: no occurrence of ${JSON.stringify(from)}`);
  files.set(path, text.split(from).join(to));
}

/** Adds a dependency to a section of package.json, keeping its formatting. */
function addDependency(files: Files, section: string, name: string, version: string): void {
  const json = JSON.parse(files.get("package.json")!);
  json[section] = { ...json[section], [name]: version };
  files.set("package.json", `${JSON.stringify(json, null, 2)}\n`);
}

const VITEST_SUITE = (body: string) =>
  `import { describe, it, expect } from 'vitest';\nimport { parseDekContent } from '../services/dekParser.js';\n\n${body}`;

const CI = (steps: string) =>
  `name: CI\non: [push, pull_request]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v5\n      - run: npm ci\n${steps}`;

export const MTGO_MUTATIONS: Mutation[] = [
  risky("dep-node-cron", [DEP], "Use node-cron for the scheduler without adding it to package.json", (f) =>
    replace(f, "server.js", "import fs from 'fs';\n", "import fs from 'fs';\nimport cron from 'node-cron';\n")),
  risky("dep-dotenv", [DEP], "Load .env with dotenv without declaring it", (f) =>
    f.set("server.js", `import 'dotenv/config';\n${f.get("server.js")}`)),
  risky("dep-date-fns", [DEP], "Format chart dates with date-fns without declaring it", (f) =>
    replace(f, "src/components/PortfolioChart.jsx", "import { Line } from 'react-chartjs-2';\n", "import { Line } from 'react-chartjs-2';\nimport { format } from 'date-fns';\n")),
  risky("dep-scoped-package", [DEP], "Fetch data with @tanstack/react-query without declaring it", (f) =>
    replace(f, "src/App.jsx", "import axios from 'axios';\n", "import axios from 'axios';\nimport { useQuery } from '@tanstack/react-query';\n")),
  risky("dep-require", [DEP], "Parse the .dek XML with a require() of fast-xml-parser", (f) =>
    replace(f, "services/dekParser.js", "import fs from 'fs';\n", "import fs from 'fs';\nconst { XMLParser } = require('fast-xml-parser');\n")),
  risky("env-api-key", [ENV], "Read SCRYFALL_API_KEY with process.env", (f) =>
    replace(f, "services/priceFetcher.js", "const cardMetadataCache = new Map();\n", "const cardMetadataCache = new Map();\nconst SCRYFALL_API_KEY = process.env.SCRYFALL_API_KEY;\n")),
  risky("env-data-dir", [ENV], "Make the data folder configurable with DATA_DIR", (f) =>
    replace(f, "services/storage.js", "const DATA_DIR = path.resolve(process.cwd(), 'data');", "const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');")),
  risky("env-vite", [ENV], "Read the API base URL from import.meta.env.VITE_API_BASE_URL", (f) =>
    replace(f, "src/App.jsx", "export function App() {\n", "const API_BASE = import.meta.env.VITE_API_BASE_URL || '';\n\nexport function App() {\n")),
  risky("env-destructured", [ENV], "Protect the API with ADMIN_PASSWORD and SYNC_TOKEN read by destructuring", (f) =>
    replace(f, "server.js", "const app = express();\n", "const app = express();\nconst { ADMIN_PASSWORD, SYNC_TOKEN } = process.env;\n")),
  risky("eslint-disable-hooks", [CD], "Silence react-hooks/exhaustive-deps on the polling effect", (f) =>
    replace(f, "src/App.jsx", "  }, []);\n", "    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n")),
  risky("eslint-disable-file", [CD], "Disable ESLint for the whole price fetcher", (f) =>
    f.set("services/priceFetcher.js", `/* eslint-disable */\n${f.get("services/priceFetcher.js")}`)),
  risky("ts-ignore", [CD], "Hide a type error on app.listen with @ts-ignore", (f) =>
    replace(f, "server.js", "app.listen(PORT, () => {\n", "// @ts-ignore\napp.listen(PORT, () => {\n")),
  risky("coverage-ignore", [CD], "Exclude the ZIP extractor from coverage", (f) =>
    replace(f, "services/priceFetcher.js", "function unzipBuffer(zipBuffer) {\n", "/* istanbul ignore next */\nfunction unzipBuffer(zipBuffer) {\n")),
  risky("test-skipped", [CD], "Add a test suite with the failing test skipped", (f) => {
    addDependency(f, "devDependencies", "vitest", "^3.2.4");
    f.set("test/dekParser.test.js", VITEST_SUITE("describe('parseDekContent', () => {\n  it('returns no cards for an empty deck', () => {\n    expect(parseDekContent('<Deck></Deck>')).toEqual([]);\n  });\n\n  it.skip('reads quantities', () => {\n    expect(parseDekContent('<Deck><Cards CatID=\"1\" Quantity=\"4\" /></Deck>')[0].quantity).toBe(4);\n  });\n});\n"));
  }),
  risky("test-focused", [CD], "Add a test suite with describe.only left in", (f) => {
    addDependency(f, "devDependencies", "vitest", "^3.2.4");
    f.set("test/dekParser.test.js", VITEST_SUITE("describe.only('parseDekContent', () => {\n  it('returns no cards for an empty deck', () => {\n    expect(parseDekContent('<Deck></Deck>')).toEqual([]);\n  });\n});\n"));
  }),
  risky("ci-or-true", [CD], "Add CI whose build step can never fail", (f) =>
    f.set(".github/workflows/ci.yml", CI("      - run: npm run build || true\n"))),
  risky("dep-and-env", [DEP, ENV], "Limit Scryfall concurrency with p-limit and SCRYFALL_CONCURRENCY", (f) =>
    replace(f, "services/priceFetcher.js", "import zlib from 'zlib';\n", "import zlib from 'zlib';\nimport pLimit from 'p-limit';\n\nconst limit = pLimit(Number(process.env.SCRYFALL_CONCURRENCY || 5));\n")),

  risky("param-added-beside-new-tests", [IF], "Add a first test suite and change the parameters of a function it does not cover", (f) => {
    addDependency(f, "devDependencies", "vitest", "^3.2.4");
    f.set("test/dekParser.test.js", VITEST_SUITE("describe('parseDekContent', () => {\n  it('returns no cards for an empty deck', () => {\n    expect(parseDekContent('<Deck></Deck>')).toEqual([]);\n  });\n});\n"));
    replace(f, "services/dekParser.js", "export function parseDekFile(filePath) {", "export function parseDekFile(filePath, encoding = 'utf-8') {");
  }),
  benign("param-added-no-tests", "Add a parameter to an exported function in an app without tests", (f) =>
    replace(f, "services/dekParser.js", "export function parseDekFile(filePath) {", "export function parseDekFile(filePath, encoding = 'utf-8') {")),
  benign("param-added-tested", "Add a parameter to an exported function and a test suite that calls it", (f) => {
    addDependency(f, "devDependencies", "vitest", "^3.2.4");
    f.set("test/dekParser.test.js", VITEST_SUITE("describe('parseDekContent', () => {\n  it('returns no cards for an empty deck', () => {\n    expect(parseDekContent('<Deck></Deck>')).toEqual([]);\n  });\n});\n"));
    replace(f, "services/dekParser.js", "export function parseDekContent(xmlContent) {", "export function parseDekContent(xmlContent, options = {}) {");
  }),
  benign("dep-declared", "Add node-cron to package.json and import it", (f) => {
    addDependency(f, "dependencies", "node-cron", "^4.2.1");
    replace(f, "server.js", "import fs from 'fs';\n", "import fs from 'fs';\nimport cron from 'node-cron';\n");
  }),
  benign("node-builtins", "Import Node built-ins, with and without the node: prefix", (f) =>
    replace(f, "services/storage.js", "import path from 'path';\n", "import path from 'path';\nimport crypto from 'crypto';\nimport { setTimeout as sleep } from 'node:timers/promises';\n")),
  benign("local-import", "Import a module of the app itself", (f) =>
    replace(f, "src/components/SchedulerModal.jsx", "import React", "import { DashboardStats } from './DashboardStats';\nimport React")),
  benign("new-icon", "Use one more icon from lucide-react", (f) =>
    replace(f, "src/components/Navbar.jsx", "Globe, PlusCircle }", "Globe, PlusCircle, Bell }")),
  benign("new-component", "Add a component that uses declared packages", (f) =>
    f.set("src/components/EmptyState.jsx", "import React from 'react';\nimport { Inbox } from 'lucide-react';\n\nexport function EmptyState({ text }) {\n  return (\n    <div className=\"empty-state\">\n      <Inbox size={32} />\n      <p>{text}</p>\n    </div>\n  );\n}\n")),
  benign("env-documented", "Read DATA_DIR and add it to .env.example", (f) => {
    replace(f, ".env.example", "NODE_ENV=production\n", "NODE_ENV=production\nDATA_DIR=./data\n");
    replace(f, "services/storage.js", "const DATA_DIR = path.resolve(process.cwd(), 'data');", "const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');");
  }),
  benign("env-already-documented", "Read PORT in the Vite proxy configuration", (f) =>
    replace(f, "vite.config.js", "target: 'http://localhost:3001',", "target: `http://localhost:${process.env.PORT || 3001}`,")),
  benign("env-standard-and-builtin", "Branch on NODE_ENV and import.meta.env.DEV", (f) => {
    replace(f, "server.js", "app.use(cors());\n", "if (process.env.NODE_ENV !== 'production') {\n  app.use(cors());\n}\n");
    replace(f, "src/App.jsx", "export function App() {\n", "const DEBUG = import.meta.env.DEV;\n\nexport function App() {\n");
  }),
  benign("env-write", "Set an environment variable instead of reading it", (f) =>
    replace(f, "server.js", "const app = express();\n", "process.env.SYNC_STARTED_AT = new Date().toISOString();\nconst app = express();\n")),
  benign("rename-function", "Rename performPriceSync everywhere", (f) =>
    replaceAll(f, "server.js", "performPriceSync", "runPriceSync")),
  benign("test-added", "Add a test suite and declare vitest", (f) => {
    addDependency(f, "devDependencies", "vitest", "^3.2.4");
    f.set("test/dekParser.test.js", VITEST_SUITE("describe('parseDekContent', () => {\n  it('returns no cards for an empty deck', () => {\n    expect(parseDekContent('<Deck></Deck>')).toEqual([]);\n  });\n});\n"));
  }),
  benign("ci-added", "Add CI that installs and builds", (f) =>
    f.set(".github/workflows/ci.yml", CI("      - run: npm run build\n"))),
  benign("optional-packages", "Load sharp only when it is installed", (f) =>
    replace(f, "services/priceFetcher.js", "const cardMetadataCache = new Map();\n", "const cardMetadataCache = new Map();\n\nlet sharp = null;\ntry {\n  sharp = require('sharp');\n} catch {\n  sharp = null;\n}\nconst loadCanvas = () => import('canvas').catch(() => null);\n")),
  benign("readme-mentions", "Document conventions in the README, with code samples", (f) =>
    f.set("README.md", `${f.get("README.md")}\n## Conventions\n\nRead settings with \`process.env.MY_SETTING\`, never add \`// eslint-disable\`, and do not \`import x from 'new-package'\` without declaring it.\n`)),
];
