import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, ConfigError, toJson, toMarkdown } from "./index.js";
import { runTestsAtBaseAndHead } from "./test-runner.js";
import type { Finding, Report } from "./types.js";

export const COMMENT_MARKER = "<!-- rsp:report -->";

type Env = Record<string, string | undefined>;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Runs rsp as a GitHub Action step. Returns the process exit code. */
export async function runAction(env: Env = process.env, fetchImpl: Fetch = fetch): Promise<number> {
  const input = (name: string) => (env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
  const list = (name: string) =>
    input(name)
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

  const failOn = input("fail-on") || "never";
  if (failOn !== "never" && failOn !== "any") {
    log(`::error::fail-on must be "never" or "any", got "${failOn}"`);
    return 1;
  }

  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? "", "utf8"));
  const pr = event.pull_request;
  if (!pr) {
    log(`::notice::rsp checks pull requests; event "${env.GITHUB_EVENT_NAME}" has none, nothing to do.`);
    return 0;
  }

  const repoDir = env.GITHUB_WORKSPACE ?? process.cwd();
  const retries = Number(input("test-retries") || "1");
  if (!Number.isInteger(retries) || retries < 0) {
    log(`::error::test-retries must be a whole number, got "${input("test-retries")}"`);
    return 1;
  }
  let junit: { junitBase: string[]; junitHead: string[]; coverage: string[] } | undefined;
  if (input("test-command") && env.GITHUB_EVENT_NAME === "pull_request_target") {
    // pull_request_target runs with a write token and secrets; the test command would run the pull request's code with them.
    log("::error::test-command runs the pull request's code and is refused on pull_request_target; use the pull_request event.");
    return 1;
  }
  if (input("test-command")) {
    if (persistedCredentials(repoDir)) {
      log(
        "::warning::The checkout keeps the token in .git/config, where the test command can read it. " +
          "Use actions/checkout with persist-credentials: false.",
      );
    }
    try {
      junit = runTestsAtBaseAndHead({
        repoDir,
        base: pr.base.sha,
        head: pr.head.sha,
        command: input("test-command"),
        junit: input("junit") || "**/junit*.xml",
        coverage: input("coverage") || undefined,
        retries,
        workDir: env.RUNNER_TEMP ?? process.cwd(),
        log,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`::error::rsp could not run the tests at base and head: ${escapeData(msg)}`);
      return 1;
    }
  }

  let report: Report;
  try {
    report = check({
      repoDir,
      base: pr.base.sha,
      head: pr.head.sha,
      rules: list("rules").length > 0 ? list("rules") : undefined,
      exclude: list("exclude"),
      ...junit,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof ConfigError) {
      log(`::error::rsp configuration is invalid: ${escapeData(msg)}`);
      return 1;
    }
    log(`::error::rsp could not read the pull request commits. Check out with fetch-depth: 0. ${escapeData(msg)}`);
    return 1;
  }

  const markdown = toMarkdown(report);
  const reportPath = join(env.RUNNER_TEMP ?? process.cwd(), "rsp-report.json");
  writeFileSync(reportPath, toJson(report));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `findings=${report.findings.length}\nreport=${reportPath}\n`);
  for (const f of report.findings) log(annotation(f));

  if (input("comment") !== "false") {
    const token = input("github-token");
    const repo = env.GITHUB_REPOSITORY ?? "";
    const api = env.GITHUB_API_URL ?? "https://api.github.com";
    try {
      await upsertComment(fetchImpl, api, token, repo, pr.number, `${COMMENT_MARKER}\n${markdown}`, report.findings.length > 0);
    } catch (err) {
      // Pull requests from forks get a read-only token; the summary still has the report.
      const msg = err instanceof Error ? err.message : String(err);
      log(`::warning::rsp could not write the pull request comment: ${escapeData(msg)}`);
    }
  }

  log(`rsp: ${report.findings.length} finding(s); report at ${reportPath}`);
  if (failOn === "any" && report.findings.length > 0) {
    log(`::error::rsp found ${report.findings.length} fact(s) and fail-on is "any"`);
    return 1;
  }
  return 0;
}

/**
 * Keeps one comment per pull request: updates it when present, creates it only
 * when there is something to report.
 */
async function upsertComment(
  fetchImpl: Fetch, api: string, token: string, repo: string, number: number, body: string, hasFindings: boolean,
): Promise<void> {
  const request = async (method: string, path: string, payload?: unknown) => {
    const res = await fetchImpl(`${api}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(payload ? { "content-type": "application/json" } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path} returned ${res.status}`);
    return res.json();
  };

  let existing: { id: number } | undefined;
  for (let page = 1; !existing; page++) {
    const comments = (await request("GET", `/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`)) as {
      id: number;
      body?: string;
      user?: { type?: string };
    }[];
    // Only a bot's comment can be ours; anyone can paste the marker into a comment of their own.
    existing = comments.find((c) => c.user?.type === "Bot" && c.body?.startsWith(COMMENT_MARKER));
    if (comments.length < 100) break;
  }

  if (existing) await request("PATCH", `/repos/${repo}/issues/comments/${existing.id}`, { body });
  else if (hasFindings) await request("POST", `/repos/${repo}/issues/${number}/comments`, { body });
}

/** Whether actions/checkout left an authorization header in the repository's git config. */
function persistedCredentials(repoDir: string): boolean {
  try {
    return execFileSync("git", ["config", "--local", "--get-regexp", "^http\\..*\\.extraheader$"], {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() !== "";
  } catch {
    return false; // git exits 1 when no key matches
  }
}

function annotation(f: Finding): string {
  const loc = f.locations[0];
  const props = [`title=${escapeProperty(`rsp ${f.ruleId}`)}`];
  if (loc) props.unshift(`file=${escapeProperty(loc.path)}`, ...(loc.line ? [`line=${loc.line}`] : []));
  return `::warning ${props.join(",")}::${escapeData(f.message)}`;
}

function escapeData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}
