// Line coverage reports: LCOV (`lcov.info`, written by c8, nyc, Jest, Vitest,
// coverage.py's `coverage lcov`) and Cobertura XML (`coverage.xml`, written by
// coverage.py, pytest-cov, Jest and Vitest). Only hits per line are read.

/** Hits by line number, by file path as the report writes it. */
export type LineHits = Map<string, Map<number, number>>;

export function parseCoverage(text: string): LineHits | undefined {
  const body = text.replace(/^﻿/, "");
  if (/^SF:/m.test(body)) return parseLcov(body);
  if (/<coverage\b/.test(body)) return parseCobertura(body);
  return undefined;
}

function parseLcov(text: string): LineHits {
  const out: LineHits = new Map();
  let lines: Map<number, number> | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      const file = line.slice(3);
      lines = out.get(file) ?? new Map();
      out.set(file, lines);
    } else if (line === "end_of_record") {
      lines = undefined;
    } else if (lines && line.startsWith("DA:")) {
      const [n, hits] = line.slice(3).split(",");
      add(lines, Number(n), Number(hits));
    }
  }
  return out;
}

const ATTR = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

function attrs(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of tag.matchAll(ATTR)) out.set(a[1]!, (a[3] ?? a[4] ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
  return out;
}

function parseCobertura(xml: string): LineHits {
  const out: LineHits = new Map();
  const text = xml.replace(/<!--[\s\S]*?-->/g, "");
  const sources = [...text.matchAll(/<source>([^<]*)<\/source>/g)].map((m) => m[1]!.trim()).filter(Boolean);
  for (const cls of text.matchAll(/<class\b([^>]*)>([\s\S]*?)<\/class>/g)) {
    const filename = attrs(cls[1]!).get("filename");
    if (!filename) continue;
    // A class names its file relative to the source; with several sources it is unclear which, so the name is used as it is.
    const name = filename.startsWith("/") || sources.length !== 1 ? filename : `${sources[0]!.replace(/\/$/, "")}/${filename}`;
    const lines = out.get(name) ?? new Map<number, number>();
    out.set(name, lines);
    for (const l of cls[2]!.matchAll(/<line\b([^>]*?)\/?>/g)) {
      const a = attrs(l[1]!);
      add(lines, Number(a.get("number")), Number(a.get("hits")));
    }
  }
  return out;
}

function add(lines: Map<number, number>, n: number, hits: number): void {
  if (!Number.isInteger(n) || n < 1 || !Number.isFinite(hits)) return;
  lines.set(n, Math.max(lines.get(n) ?? 0, hits));
}

/**
 * Coverage by repository path. A path in a report is matched to the tracked
 * file that is its longest path suffix, so absolute paths of the machine that
 * ran the tests still match; paths matching no file are dropped. Several
 * reports, such as one per package, are merged by taking the most hits.
 */
export function coverageByRepoPath(reports: LineHits[], repoFiles: string[]): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  for (const report of reports) {
    for (const [written, lines] of report) {
      const path = written.replace(/\\/g, "/").replace(/^\.\//, "");
      let best: string | undefined;
      for (const f of repoFiles) {
        if ((path === f || path.endsWith(`/${f}`)) && (!best || f.length > best.length)) best = f;
      }
      if (!best) continue;
      const merged = out.get(best) ?? new Map<number, number>();
      out.set(best, merged);
      for (const [n, hits] of lines) add(merged, n, hits);
    }
  }
  return out;
}
