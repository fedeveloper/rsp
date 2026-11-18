# How RSP is validated

Back to the [README](../README.md) · [Rules](RULES.md) · [User guide](GUIDE.md)

Passing its own tests proves that RSP is consistent, not that its rules work on real code. Every rule change goes through four layers, and a fifth evaluation measures RSP on patches written by coding agents.

1. **Golden fixtures** (`test/fixtures/<rule>/<case>/`). Each case is a `base/` tree, a `head/` tree, optional JUnit reports in `reports/`, and an `expected.json` written by hand before running the rule. The harness builds a throwaway git repository per case with fixed authors and dates, and runs **every** rule on **every** case, so a rule that fires on another rule's fixture fails too.
2. **Labelled mutations** (`npm run eval`). Risky and benign changes are applied to each corpus; each risky change must be reported by exactly the expected rules and each benign one by none. CI fails if the results change.
   - A small sample Python project: [eval/RESULTS.md](../eval/RESULTS.md).
   - A small TypeScript web service: [eval/RESULTS_JS.md](../eval/RESULTS_JS.md).
   - A small Go service: [eval/RESULTS_GO.md](../eval/RESULTS_GO.md).
   - Corpora built on real applications whose code should not be copied here are kept outside the repository and loaded with `RSP_EVAL_EXTRA=<file>` (see `eval/run.ts`). Their results are not part of CI.
3. **Real history** (`eval/real-history.ts`). Every rule runs on about 100 recent commits of public projects, and each line-level finding is checked against git independently of the rules: the reported line holds the evidence, the line occurs more often after the commit than before, and for signatures the definition really changed. Python: flask, requests, httpx, fastapi, click ([eval/REAL_HISTORY.md](../eval/REAL_HISTORY.md)). JavaScript/TypeScript: express, axios, fastify, vite, outline ([eval/REAL_HISTORY_JS.md](../eval/REAL_HISTORY_JS.md)). Go: cobra, gin, chi, testify, viper ([eval/REAL_HISTORY_GO.md](../eval/REAL_HISTORY_GO.md)). Every false fact found this way was fixed and became a golden fixture.
4. **Action tests** against a fake GitHub API: comment created, updated and cleared, read-only tokens, `fail-on`, invalid configuration, the test command at base and head with a flaky rerun, and one run from the committed bundle. On every pull request of RSP itself, an end-to-end job also runs the Action from `action.yml` on a real runner, compares its report with the CLI on the same commits and checks that the test command saw no tokens.

## Patches written by coding agents

`eval/swe-bench.ts` runs RSP on the 300 tasks of [SWE-bench Lite](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Lite), real issues of 12 Python projects. For each task it checks the pull request that fixed the issue and the patches written by three agents from public leaderboard submissions (SWE-agent with Claude 4 Sonnet, Agentless Lite with o3-mini, Moatless Tools with DeepSeek V3). The full report is [eval/SWE_BENCH.md](../eval/SWE_BENCH.md).

| Patches by | Patches | With findings | Resolved, with findings | Not resolved, with findings |
| --- | --- | --- | --- | --- |
| Human fix (code and test patch) | 300 | 10 (3%) | | |
| SWE-agent + Claude 4 Sonnet | 300 | 11 (4%) | 4 of 170 | 7 of 130 |
| Agentless Lite + o3-mini | 294 | 4 (1%) | 2 of 97 | 2 of 197 |
| Moatless Tools + DeepSeek V3 | 287 | 0 | 0 of 92 | 0 of 195 |

What this shows, and what it does not:

- **Findings are rare, as intended.** SWE-bench tasks are small bug fixes, and RSP only speaks when one of its specific facts is true. On the human fixes, every finding is a deliberate skip marker or a test that lost assertions while being rewritten.
- **The agent findings are the shortcuts RSP is for.** One agent patch deletes the project's whole test file (`test_requests.py`); others add `# type: ignore`, or add parameters to public functions without touching a test. Of the 11 SWE-agent findings, 7 are on patches that did not resolve their task.
- **The first run found false facts, now fixed.** Skip markers and imports inside Python strings (pytest's own tests write test code into strings), dependency lists built in `setup.py` variables or imported from another module, `pytest` imported by test files of projects that declare it in tox or conda files, a method defined twice in one class, and a backslash at the end of a docstring line that shifted line numbers. Each became a golden fixture.
- **It is not a detector of wrong patches.** Most unresolved patches have no finding, because most wrong patches are wrong in ways only tests or a reviewer can see. `tests/delta` with the task's tests would see more, and is not part of this run.
