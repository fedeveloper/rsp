#!/usr/bin/env node
import { parseArgs } from "node:util";
import { check, toJson, toMarkdown } from "./index.js";
import { ALL_RULES } from "./rules/index.js";
import { VERSION } from "./version.js";

const USAGE = `Usage: rsp check --base <ref> [--head <ref>] [options]

Reports reproducible facts about risky changes between two commits.
The base is resolved to its merge-base with the head.

Options:
  --base <ref>      Commit, branch or tag to compare against (required)
  --head <ref>      Commit to check (default: HEAD)
  --repo <dir>      Repository directory (default: current directory)
  --format <fmt>    json or markdown (default: markdown)
  --rule <id>       Run only this rule; repeatable
  --list-rules      Print the available rules and exit
  --version         Print the version and exit
  --help            Print this help and exit
`;

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      base: { type: "string" },
      head: { type: "string", default: "HEAD" },
      repo: { type: "string", default: process.cwd() },
      format: { type: "string", default: "markdown" },
      rule: { type: "string", multiple: true },
      "list-rules": { type: "boolean", default: false },
      version: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (values["list-rules"]) {
    for (const r of ALL_RULES) process.stdout.write(`${r.id}@${r.version}\t${r.description}\n`);
    return 0;
  }
  if (positionals[0] !== "check" || !values.base) {
    process.stderr.write(USAGE);
    return 2;
  }
  if (values.format !== "json" && values.format !== "markdown") {
    process.stderr.write(`Unknown format: ${values.format}\n`);
    return 2;
  }

  const report = check({ repoDir: values.repo, base: values.base, head: values.head, rules: values.rule });
  process.stdout.write(values.format === "json" ? toJson(report) : toMarkdown(report));
  // Advisory by default: findings never change the exit code yet.
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`rsp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 2;
}
