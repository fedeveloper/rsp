// JUnit XML reports, as written by pytest (--junitxml), jest (jest-junit),
// vitest (--reporter=junit), mocha, Go and most CI tools. Only test cases and
// their outcome are read, with a small scanner rather than an XML library.

export type TestStatus = "passed" | "failed" | "skipped";

export interface TestRun {
  /** Report files the results were read from, in the order given. */
  files: string[];
  /** Outcome by test id (`classname::name`). */
  results: Map<string, TestStatus>;
  /** Tests that failed and passed in the same run: in different reports, such as a rerun, or retried by the runner. Sorted. */
  flaky: string[];
  /** Reports that open a test suite and do not close it, as when the test process was killed while writing. */
  incomplete: string[];
}

export interface ParsedReport {
  results: Map<string, TestStatus>;
  /** Tests the runner retried within the report and that passed in the end. */
  retried: Set<string>;
  complete: boolean;
}

const TESTCASE = /<testcase\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
const ATTR = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** Outcome of every test case in one report. */
export function parseJUnit(xml: string): Map<string, TestStatus> {
  return parseReport(xml).results;
}

export function parseReport(xml: string): ParsedReport {
  const results = new Map<string, TestStatus>();
  const retried = new Set<string>();
  const text = xml.replace(/^\uFEFF/, "").replace(/<!--[\s\S]*?-->/g, "");
  for (const m of text.matchAll(TESTCASE)) {
    const attrs = new Map<string, string>();
    for (const a of m[1]!.matchAll(ATTR)) attrs.set(a[1]!, unescape(a[3] ?? a[4] ?? ""));
    const name = attrs.get("name");
    if (!name) continue;
    const body = (m[3] ?? "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
    const status: TestStatus = /<(failure|error)\b/.test(body) ? "failed" : /<skipped\b/.test(body) ? "skipped" : "passed";
    const id = [attrs.get("classname") || attrs.get("file"), name].filter(Boolean).join("::");
    // pytest-rerunfailures and Maven Surefire record failed attempts of a test that passed in the end.
    if (status === "passed" && /<(rerunFailure|rerunError|flakyFailure|flakyError)\b/.test(body)) retried.add(id);
    results.set(id, combine(results.get(id), status));
  }
  const root = /<(testsuites|testsuite)\b(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/.exec(text);
  const complete = !root || root[2] === "/" || new RegExp(`</${root[1]}\\s*>$`).test(text.trimEnd());
  return { results, retried, complete };
}

/**
 * Merges several reports of the same commit, such as shards or reruns. A test
 * that passed in any of them counts as passed, so a rerun clears a flaky failure.
 */
export function mergeRuns(files: { path: string; xml: string }[]): TestRun {
  const results = new Map<string, TestStatus>();
  const failed = new Set<string>();
  const flaky = new Set<string>();
  const incomplete: string[] = [];
  for (const f of files) {
    const report = parseReport(f.xml);
    if (!report.complete) incomplete.push(f.path);
    report.retried.forEach((id) => flaky.add(id));
    for (const [id, status] of report.results) {
      if (status === "failed") failed.add(id);
      results.set(id, combine(results.get(id), status));
    }
  }
  for (const id of failed) if (results.get(id) === "passed") flaky.add(id);
  return { files: files.map((f) => f.path), results, flaky: [...flaky].sort(), incomplete };
}

function combine(a: TestStatus | undefined, b: TestStatus): TestStatus {
  if (a === undefined) return b;
  if (a === "passed" || b === "passed") return "passed";
  if (a === "failed" || b === "failed") return "failed";
  return "skipped";
}

function unescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}
