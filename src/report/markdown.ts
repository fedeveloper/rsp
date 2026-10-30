import { codeSpan } from "../text.js";
import type { Finding, Report } from "../types.js";

export function toMarkdown(report: Report): string {
  const range = `${short(report.base)}..${short(report.head)}`;
  const n = report.findings.length;
  const lines = [
    `### RSP · ${n} ${n === 1 ? "fact" : "facts"} on ${range} (rsp ${report.tool.version})`,
    "",
  ];

  if (n === 0) {
    const r = report.rules.length;
    lines.push(r === 1 ? "The one rule run found no facts in this diff." : `None of the ${r} rules found facts in this diff.`);
  } else {
    lines.push("| Rule | Where | Fact | Evidence |", "| --- | --- | --- | --- |");
    for (const f of report.findings) {
      lines.push(`| ${inline(f.ruleId)} | ${where(f)} | ${inline(f.message)} | ${cell(codeSpan(f.evidence))} |`);
    }
  }

  const flaky = report.tests?.flaky ?? [];
  if (flaky.length > 0) {
    const shown = flaky.slice(0, 20).map((id) => cell(codeSpan(id))).join(", ");
    const more = flaky.length > 20 ? ` and ${flaky.length - 20} more` : "";
    lines.push("", `Failed and also passed at head, not counted as failures: ${shown}${more}.`);
  }
  for (const file of report.tests?.incomplete ?? []) {
    lines.push("", `The head report ${codeSpan(file)} is cut off, so tests missing from it are not reported.`);
  }

  const opts = report.options.map((o) => ` ${o}`).join("");
  if (report.config) lines.push("", `Configuration: ${codeSpan(report.config)} from the base commit.`);
  lines.push(
    "",
    `Reproduce: ${codeSpan(`rsp check --base ${report.base} --head ${report.head}${opts}`)}`,
    "",
    `<sub>Install: \`npm install -g github:fedeveloper/rsp#v${report.tool.version}\`. ` +
      "Findings are facts about the diff, not a review: no findings does not mean the change is correct.</sub>",
    "",
  );
  return lines.join("\n");
}

function where(f: Finding): string {
  const loc = f.locations[0];
  if (!loc) return "";
  return cell(codeSpan(loc.line ? `${loc.path}:${loc.line}` : loc.path));
}

/**
 * Renders a message whose code spans quote text from the diff. Code spans are
 * kept as they are; everything else is escaped, so the comment shows the
 * message as plain text: no links, images, HTML or @mentions.
 */
function inline(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const run = /^`+/.exec(s.slice(i));
    if (run) {
      const fence = run[0];
      const close = findClosing(s, i + fence.length, fence.length);
      if (close >= 0) {
        out += cell(s.slice(i, close + fence.length));
        i = close + fence.length;
      } else {
        out += "&#96;".repeat(fence.length);
        i += fence.length;
      }
      continue;
    }
    out += escapeText(s[i]!);
    i++;
  }
  return out;
}

/** Start of the next backtick run of exactly `n` backticks at or after `from`, or -1. */
function findClosing(s: string, from: number, n: number): number {
  for (const m of s.slice(from).matchAll(/`+/g)) {
    if (m[0].length === n) return from + m.index!;
  }
  return -1;
}

function escapeText(c: string): string {
  if (c === "<") return "&lt;";
  if (c === ">") return "&gt;";
  if (c === "&") return "&amp;";
  if (c === "@") return "&#64;";
  if (c === "|") return "&#124;";
  if (c === "\n" || c === "\r") return " ";
  return /[\\*_[\]()#!~]/.test(c) ? `\\${c}` : c;
}

/**
 * Inside a table, a code span still ends the cell at `|` and the row at a
 * newline. GFM treats every `\|` in a row as an escaped pipe, even after
 * another backslash, so backslashes need no escaping of their own.
 */
function cell(s: string): string {
  return s.split("|").join("\\|").replace(/[\r\n]+/g, " ");
}

function short(sha: string): string {
  return sha.slice(0, 12);
}
