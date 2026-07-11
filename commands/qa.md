---
description: Certify a scope's implementation and planning against its full specification
argument-hint: [scope-name]
---

# /kyro:qa — Certification

Audit a scope's code, architecture, security, testing, and planning artifacts against its specification.

This command is **independent of the forge cycle** — use it anytime to validate that work meets its contract.

## Startup

1. Read `.agents/kyro/kyro.json`.
2. Resolve scope from `$ARGUMENTS`, `kyro.json.activeScope`, or prompt the user to select from `.agents/kyro/scopes/`.
3. Read the scope's `sprint.json`. Verify it exists and is valid.
4. Validate sprint.json is present, parseable, and synchronized with code (per the qa-review skill's validation step at `SKILL.md:106`).
5. Load `skills/qa-review/SKILL.md` to prepare the audit framework.

## Audit Scope

The QA review will validate:

- **Functional correctness**: Does the implementation satisfy the task spec?
- **Architecture alignment**: Is the code structured per project patterns?
- **Security**: Are there exposed credentials, injection risks, or authorization flaws?
- **Code quality**: Is the code clear, maintainable, and free of unnecessary technical debt?
- **Testing**: Is there sufficient test coverage and validation?
- **Reliability**: Are error cases handled? Do failure modes make sense?
- **Performance**: Are there N+1 queries, unbounded operations, or scaling issues?
- **Planning sync**: Are `sprint.json`, roadmap, task verdicts, and handoff in sync with the code?

## Output

The review will produce one of four verdicts (these are QA report conclusions and do not get written into `sprint.json` task verdicts, which use a separate `pass`/`fail` schema for `/kyro:forge`'s gate system):

- **APPROVED** — implementation is correct and ready to ship/merge
- **APPROVED WITH NOTES** — acceptable with non-blocking recommendations
- **CHANGES REQUIRED** — implementation is close but needs fixes before approval
- **REJECTED** — work does not meet standards and requires redesign

The review will include:

- Summary of findings (critical, major, minor)
- Specific remediation instructions (if changes are required)
- Architecture and security sign-off
- Planning artifact verification
- Final decision and blockers

This verdict is the QA report's own conclusion. It does not replace the binary `pass`/`fail` task-level verdicts used by `/kyro:forge`'s `review_task` step.

## Rules

- `/kyro:qa` is read-only. It never writes to `sprint.json`, `kyro.json`, or any scope artifact — the review is a markdown report only, per `skills/qa-review/SKILL.md`'s output format.
- `/kyro:qa` never loads `agents/orchestrator.md` — it loads `skills/qa-review/SKILL.md` directly and stands outside the forge gate lifecycle.
- QA is independent — can be run at any point, not just at phase gates.
- The audit is strict but pragmatic — it protects architecture and maintainability.
- If implementation contradicts the spec, that is a REJECTED or CHANGES REQUIRED verdict.
- If planning artifacts are stale or misleading, that blocks approval regardless of code quality.
- If testing is missing and required, that is a blocking issue.
- The verdict is not a suggestion — it is a certification decision.
