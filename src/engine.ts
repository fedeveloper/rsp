import { createHash } from "node:crypto";
import type { DiffContext, Finding, Report, Rule } from "./types.js";
import { VERSION } from "./version.js";

export function runRules(ctx: DiffContext, rules: Rule[]): Report {
  const findings: Finding[] = [];
  for (const rule of rules) {
    for (const raw of rule.run(ctx)) {
      findings.push({
        ruleId: rule.id,
        ruleVersion: rule.version,
        message: raw.message,
        locations: raw.locations,
        evidence: raw.evidence,
        fingerprint: "",
        reproduce: `npx rsp check --base ${ctx.base} --head ${ctx.head} --rule ${rule.id}`,
      });
    }
  }
  findings.sort(compareFindings);
  assignFingerprints(findings);

  return {
    tool: { name: "rsp", version: VERSION },
    base: ctx.base,
    head: ctx.head,
    rules: rules.map((r) => ({ id: r.id, version: r.version })).sort((a, b) => cmp(a.id, b.id)),
    findings,
  };
}

function compareFindings(a: Finding, b: Finding): number {
  const la = a.locations[0];
  const lb = b.locations[0];
  return (
    cmp(la?.path ?? "", lb?.path ?? "") ||
    (la?.line ?? 0) - (lb?.line ?? 0) ||
    cmp(a.ruleId, b.ruleId) ||
    cmp(a.message, b.message)
  );
}

/**
 * Fingerprints ignore line numbers so the same finding keeps its identity when
 * unrelated lines shift between pushes. Identical findings get an ordinal.
 */
function assignFingerprints(findings: Finding[]): void {
  const seen = new Map<string, number>();
  for (const f of findings) {
    const key = [f.ruleId, f.locations[0]?.path ?? "", f.evidence.trim()].join("\0");
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const hash = createHash("sha256").update(`${key}\0${n}`).digest("hex");
    f.fingerprint = hash.slice(0, 16);
  }
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
