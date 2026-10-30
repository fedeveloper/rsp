import type { TestRun } from "./junit.js";

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffLine {
  kind: "add" | "del";
  text: string;
  /** Line number in the base file (only for "del"). */
  oldLine?: number;
  /** Line number in the head file (only for "add"). */
  newLine?: number;
}

export interface FileChange {
  /** Path in head, or in base when the file was deleted. */
  path: string;
  /** Path in base, differs from `path` only for renames. */
  oldPath: string;
  status: FileStatus;
  binary: boolean;
  lines: DiffLine[];
}

export interface DiffContext {
  repoDir: string;
  /** Full SHA of the merge-base the head is compared against. */
  base: string;
  /** Full SHA of the head commit. */
  head: string;
  files: FileChange[];
  /** File content at base, or undefined when absent. */
  readBase(path: string): string | undefined;
  /** File content at head, or undefined when absent. */
  readHead(path: string): string | undefined;
  /** Every file path tracked at head, sorted. */
  listHead(): string[];
  /** Test results at base and head, when JUnit reports were given. */
  tests?: { base: TestRun; head: TestRun };
  /** Hits by line of each tracked file in the coverage reports of the tests at head, when given. */
  coverage?: Map<string, Map<number, number>>;
}

export interface Location {
  path: string;
  line?: number;
}

export interface Finding {
  ruleId: string;
  ruleVersion: string;
  /**
   * What `allow` in .rsp.toml matches to accept this finding: a pattern id, a
   * package, a variable or a symbol name, depending on the rule.
   */
  key: string;
  /** A fact about the diff, never a judgement. */
  message: string;
  locations: Location[];
  /** The diff line or manifest excerpt the fact is based on. */
  evidence: string;
  /** Stable across pushes: does not depend on line numbers or SHAs. */
  fingerprint: string;
  /** CLI command that reproduces this finding. */
  reproduce: string;
}

/** What a rule returns; the engine adds version, fingerprint and reproduce. */
export type RawFinding = Pick<Finding, "key" | "message" | "locations" | "evidence">;

export interface Rule {
  id: string;
  version: string;
  description: string;
  /** What the keys of this rule's findings are, for `allow` in .rsp.toml. */
  keys: string;
  /** Every key the rule can report, when it is a closed set; `allow` is checked against it. */
  knownKeys?: string[];
  run(ctx: DiffContext): RawFinding[];
}

export interface Report {
  tool: { name: string; version: string };
  base: string;
  head: string;
  /** Extra CLI flags the run used, such as `--exclude`. */
  options: string[];
  /** The configuration file read from the base commit, or null. */
  config: string | null;
  rules: { id: string; version: string }[];
  findings: Finding[];
  /**
   * Notes on the head test run, when JUnit reports were given: they are about
   * the run, not the diff, so they are not findings.
   */
  tests?: {
    /** Tests that failed and also passed at head, such as on a rerun. */
    flaky: string[];
    /** Head reports that were cut off, so missing tests are not reported. */
    incomplete: string[];
  };
}
