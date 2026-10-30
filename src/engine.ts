import { createHash } from "node:crypto";
import type { Config } from "./config.js";
import { globToRegExp } from "./glob.js";
import type { DiffContext, Finding, Report, Rule } from "./types.js";
import { VERSION } from "./version.js";

/**
 * `options` are the CLI flags besides base, head and rule needed to reproduce a
 * run. `config` drops the findings a rule's `exclude` and `allow` accept;
 * disabled rules are expected to be left out of `rules` by the caller.
 */
export function runRules(ctx: DiffContext, rules: Rule[], options: string[] = [], config?: Config): Report {
  const opts = options.map((o) => ` ${o}`).join("");
  const findings: Finding[] = [];
  for (const rule of rules) {
    const rc = config?.rules[rule.id];
    const excluded = (rc?.exclude ?? []).map(globToRegExp);
    for (const raw of rule.run(ctx)) {
      if (rc?.allow.includes(raw.key)) continue;
      if (raw.locations.some((l) => excluded.some((re) => re.test(l.path)))) continue;
      findings.push({
        ruleId: rule.id,
        ruleVersion: rule.version,
        key: raw.key,
        message: raw.message,
        locations: raw.locations,
        evidence: raw.evidence,
        fingerprint: "",
        reproduce: `rsp check --base ${ctx.base} --head ${ctx.head}${opts} --rule ${rule.id}`,
      });
    }
  }
  findings.sort(compareFindings);
  assignFingerprints(findings);

  return {
    tool: { name: "rsp", version: VERSION },
    base: ctx.base,
    head: ctx.head,
    options,
    config: config?.path ?? null,
    rules: rules.map((r) => ({ id: r.id, version: r.version })).sort((a, b) => cmp(a.id, b.id)),
    findings,
    ...(ctx.tests && { tests: { flaky: ctx.tests.head.flaky, incomplete: ctx.tests.head.incomplete } }),
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
