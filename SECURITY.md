# Security policy

## Supported versions

Security fixes are released for the latest minor version. Pin the Action by the commit SHA of a release and let Dependabot propose updates.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through [GitHub's private vulnerability reporting](https://github.com/fedeveloper/rsp/security/advisories/new) for this repository, with the steps to reproduce and the version or commit you used.

You will get an answer within seven days. Once a fix is released, the advisory is published with credit to the reporter, unless they prefer otherwise.

## Scope

In scope: the GitHub Action (`action.yml`, `action-dist/`), the `rsp` command line tool and the rules. Of particular interest:

- a pull request that makes the Action run its code, read the token or write to later steps when `test-command` is not set;
- a pull request that injects Markdown, HTML, links or mentions into the comment, or workflow commands into the log;
- a finding or comment that RSP writes somewhere other than the pull request it checks.

Out of scope: what a project's own `test-command` does, since it runs the project's tests by design.
