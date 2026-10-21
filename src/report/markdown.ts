import type { Finding, Report } from "../types.js";

export function toMarkdown(report: Report): string {
  const range = `${short(report.base)}..${short(report.head)}`;
  const n = report.findings.length;
  const lines = [
    `### rsp · ${n} ${n === 1 ? "fact" : "facts"} on ${range} (rsp ${report.tool.version})`,
    "",
  ];

  if (n === 0) {
    const r = report.rules.length;
    lines.push(r === 1 ? "The one rule run found no facts in this diff." : `None of the ${r} rules found facts in this diff.`);
  } else {
    lines.push("| Rule | Where | Fact | Evidence |", "| --- | --- | --- | --- |");
    for (const f of report.findings) {
      lines.push(`| ${f.ruleId} | ${where(f)} | ${cell(f.message)} | ${code(f.evidence)} |`);
    }
  }

  lines.push("", `Reproduce: \`npx rsp check --base ${report.base} --head ${report.head}\``, "");
  return lines.join("\n");
}

function where(f: Finding): string {
  const loc = f.locations[0];
  if (!loc) return "";
  return code(loc.line ? `${loc.path}:${loc.line}` : loc.path);
}

function code(s: string): string {
  const fence = s.includes("`") ? "``" : "`";
  const pad = s.startsWith("`") || s.endsWith("`") ? " " : "";
  return `${fence}${pad}${s.replace(/\|/g, "\\|")}${pad}${fence}`;
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function short(sha: string): string {
  return sha.slice(0, 12);
}
