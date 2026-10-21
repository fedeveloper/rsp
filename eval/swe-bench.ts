// Runs every rule on patches for the 300 tasks of SWE-bench Lite: the pull
// request that fixed each issue (its code and test patches together) and the
// patches that coding agents wrote for the same issue, from public leaderboard
// submissions. Each patch is applied to the task's base commit as one new
// commit and compared with it. Writes a report for manual review. Usage:
//   node --import tsx eval/swe-bench.ts [--limit N] [--out eval/SWE_BENCH.md]
//
// Everything is downloaded at run time into eval/.cache/swe-bench: the task
// list from Hugging Face, the predictions from the public SWE-bench S3 bucket,
// the resolved lists from the SWE-bench experiments repository at a pinned
// commit, and a bare clone of each project. Nothing from them is committed
// except the findings.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { check } from "../src/index.js";
import { ALL_RULES } from "../src/rules/index.js";
import type { Finding } from "../src/types.js";
import { VERSION } from "../src/version.js";

const { values } = parseArgs({
  options: { limit: { type: "string" }, out: { type: "string", default: "eval/SWE_BENCH.md" } },
});

const CACHE = join(import.meta.dirname, ".cache", "swe-bench");
const DATASET = "princeton-nlp/SWE-bench_Lite";
const EXPERIMENTS_COMMIT = "40f164d5b8f1d249bf95a6df8b74b577fd8e519d";
const SUBMISSIONS = [
  { id: "20250526_sweagent_claude-4-sonnet-20250514", label: "SWE-agent + Claude 4 Sonnet" },
  { id: "20250214_agentless_lite_o3_mini", label: "Agentless Lite + o3-mini" },
  { id: "20250111_moatless_deepseek_v3", label: "Moatless Tools + DeepSeek V3" },
];

interface Task {
  instance_id: string;
  repo: string;
  base_commit: string;
  patch: string;
  test_patch: string;
}

interface Source {
  label: string;
  /** Patch by task id. */
  patches: Map<string, string>;
  /** Tasks whose patch made the failing tests pass; undefined for the human fix. */
  resolved?: Set<string>;
}

interface Run {
  task: Task;
  source: Source;
  applied: boolean;
  findings: Finding[];
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** Downloads once into the cache. */
async function cached(name: string, load: () => Promise<string>): Promise<string> {
  const path = join(CACHE, name);
  if (!existsSync(path)) writeFileSync(path, await load());
  return readFileSync(path, "utf8");
}

async function loadTasks(): Promise<{ sha: string; tasks: Task[] }> {
  const sha = JSON.parse(await cached("dataset.json", () => fetchText(`https://huggingface.co/api/datasets/${DATASET}`))).sha;
  const rows = await cached("tasks.json", async () => {
    const tasks: Task[] = [];
    for (let offset = 0; offset < 300; offset += 100) {
      const page = JSON.parse(
        await fetchText(
          `https://datasets-server.huggingface.co/rows?dataset=${DATASET}&config=default&split=test&offset=${offset}&length=100`,
        ),
      );
      for (const { row } of page.rows) {
        tasks.push({ instance_id: row.instance_id, repo: row.repo, base_commit: row.base_commit, patch: row.patch, test_patch: row.test_patch });
      }
    }
    return JSON.stringify(tasks);
  });
  return { sha, tasks: (JSON.parse(rows) as Task[]).sort((a, b) => cmp(a.instance_id, b.instance_id)) };
}

async function loadSubmission(id: string, label: string): Promise<Source> {
  const preds = await cached(`${id}.jsonl`, () =>
    fetchText(`https://swe-bench-submissions.s3.amazonaws.com/lite/${id}/all_preds.jsonl`),
  );
  const results = JSON.parse(
    await cached(`${id}.results.json`, () =>
      fetchText(`https://raw.githubusercontent.com/SWE-bench/experiments/${EXPERIMENTS_COMMIT}/evaluation/lite/${id}/results/results.json`),
    ),
  );
  const patches = new Map<string, string>();
  for (const line of preds.split("\n").filter(Boolean)) {
    const p = JSON.parse(line);
    if (p.model_patch) patches.set(p.instance_id, p.model_patch);
  }
  return { label, patches, resolved: new Set(results.resolved) };
}

function repoDir(repo: string): string {
  const dir = join(CACHE, "repos", repo.replace("/", "_"));
  if (!existsSync(dir)) execFileSync("git", ["clone", "--quiet", "--bare", `https://github.com/${repo}`, dir]);
  return dir;
}

/**
 * Applies a patch on top of a commit without a working tree, through a
 * temporary index, and returns the new commit. Fixed author and dates keep
 * the commit id, and so the report, the same on every run.
 */
function commitPatch(dir: string, base: string, patch: string): string | undefined {
  const index = join(CACHE, "index");
  rmSync(index, { force: true });
  const env = {
    ...process.env,
    GIT_INDEX_FILE: index,
    GIT_AUTHOR_NAME: "rsp",
    GIT_AUTHOR_EMAIL: "rsp@example.invalid",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_NAME: "rsp",
    GIT_COMMITTER_EMAIL: "rsp@example.invalid",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
  const git = (args: string[], input?: string) =>
    execFileSync("git", ["-C", dir, ...args], { env, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1 << 28 }).trim();
  try {
    git(["read-tree", base]);
    git(["apply", "--cached", "--whitespace=nowarn", "-"], patch.endsWith("\n") ? patch : `${patch}\n`);
    return git(["commit-tree", git(["write-tree"]), "-p", base, "-m", "patch"]);
  } catch (e) {
    if (process.env.DEBUG) process.stderr.write(`${String((e as { stderr?: string }).stderr ?? e)}\n`);
    return undefined;
  } finally {
    rmSync(index, { force: true });
  }
}

function runOne(task: Task, source: Source): Run | undefined {
  const patch = source.patches.get(task.instance_id);
  if (patch === undefined) return undefined;
  const dir = repoDir(task.repo);
  const head = commitPatch(dir, task.base_commit, patch);
  if (!head) return { task, source, applied: false, findings: [] };
  const findings = check({ repoDir: dir, base: task.base_commit, head }).findings;
  return { task, source, applied: true, findings };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${Math.round((100 * n) / d)}%`;
}

const { sha, tasks: allTasks } = await (async () => {
  mkdirSync(join(CACHE, "repos"), { recursive: true });
  return loadTasks();
})();
const tasks = values.limit ? allTasks.slice(0, Number(values.limit)) : allTasks;
const human: Source = {
  label: "Human fix (code and test patch)",
  patches: new Map(allTasks.map((t) => [t.instance_id, `${t.patch.replace(/\n*$/, "\n")}${t.test_patch}`])),
};
const sources = [human, ...(await Promise.all(SUBMISSIONS.map((s) => loadSubmission(s.id, s.label))))];

const runs: Run[] = [];
for (const task of tasks) {
  for (const source of sources) {
    const run = runOne(task, source);
    if (run) runs.push(run);
  }
  process.stderr.write(".");
}
process.stderr.write("\n");

const rules = ALL_RULES.map((r) => r.id).filter((id) => id !== "tests/delta");
const out = [
  "# Findings on SWE-bench Lite patches",
  "",
  `Generated by \`eval/swe-bench.ts\` with rsp ${VERSION}. Do not edit by hand.`,
  "",
  `The ${tasks.length} tasks of [SWE-bench Lite](https://huggingface.co/datasets/${DATASET}) (dataset revision ` +
    `\`${sha.slice(0, 12)}\`) are real GitHub issues of 12 Python projects. For each task the report runs every rule on ` +
    "the pull request that fixed the issue, with its code and test patches together, and on the patches three coding " +
    "agents wrote for the same issue, taken from public leaderboard submissions in the " +
    `[SWE-bench experiments repository](https://github.com/SWE-bench/experiments/tree/${EXPERIMENTS_COMMIT}). ` +
    "Each patch becomes one commit on top of the task's base commit. \"Resolved\" means the official evaluation " +
    "found that the patch makes the task's failing tests pass without breaking the passing ones. `tests/delta` " +
    "needs test runs and is left out.",
  "",
  "Columns per rule count patches with at least one finding of that rule.",
  "",
  `| Patches by | Patches | Applied | With findings | ${rules.map((r) => `\`${r}\``).join(" | ")} |`,
  `| --- | --- | --- | --- | ${rules.map(() => "---").join(" | ")} |`,
];
const row = (label: string, rs: Run[]) => {
  const applied = rs.filter((r) => r.applied);
  const per = rules.map((id) => applied.filter((r) => r.findings.some((f) => f.ruleId === id)).length);
  const any = applied.filter((r) => r.findings.length > 0).length;
  out.push(`| ${label} | ${rs.length} | ${applied.length} | ${any} (${pct(any, applied.length)}) | ${per.join(" | ")} |`);
};
for (const source of sources) {
  const rs = runs.filter((r) => r.source === source);
  row(source.label, rs);
  if (source.resolved) {
    row(`↳ resolved`, rs.filter((r) => source.resolved!.has(r.task.instance_id)));
    row(`↳ not resolved`, rs.filter((r) => !source.resolved!.has(r.task.instance_id)));
  }
}

out.push("", "## All findings", "");
for (const source of sources) {
  const hits = runs.filter((r) => r.source === source && r.findings.length > 0);
  out.push(`### ${source.label}`, "");
  if (hits.length === 0) {
    out.push("No findings.", "");
    continue;
  }
  const header = source.resolved ? "| Task | Resolved | Rule | Where | Fact |" : "| Task | Rule | Where | Fact |";
  out.push(header, header.replace(/[^|]+/g, " --- ").trim());
  for (const r of hits) {
    for (const f of r.findings) {
      const loc = f.locations[0];
      const where = loc ? `\`${loc.path}${loc.line ? `:${loc.line}` : ""}\`` : "";
      const cells = [`\`${r.task.instance_id}\``];
      if (source.resolved) cells.push(source.resolved.has(r.task.instance_id) ? "yes" : "no");
      cells.push(`\`${f.ruleId}\``, where, f.message.replace(/\|/g, "\\|"));
      out.push(`| ${cells.join(" | ")} |`);
    }
  }
  out.push("");
}
writeFileSync(values.out!, out.join("\n"));
process.stdout.write(`${runs.length} patches; wrote ${values.out}\n`);
