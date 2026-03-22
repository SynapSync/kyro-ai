---
description: Defines mandatory quality checks before closing any task. Classifies issues as BLOCKER, WARNING, or SUGGESTION and enforces resolution policies for each.
globs: ["**/*.{ts,tsx,js,jsx,py,rs,go}"]
alwaysApply: true
---

# Quality Gates

Rules governing code quality enforcement during sprint execution.

## R-QG-01: Run All Checks Before Closing

Run lint, typecheck, and tests before closing any task.

- Commands are defined in `config.json` under `quality_gates`.
- All three must pass. A single failure keeps the task open.
- If a check is not applicable (e.g., no test suite), document why in the task notes.

## R-QG-02: BLOCKER Items Must Be Fixed

BLOCKER-level issues must be fixed before the task can be marked complete. No exceptions.

- BLOCKERs include: failing tests, type errors, lint errors that indicate bugs, security vulnerabilities.
- If a BLOCKER cannot be fixed within the current task scope, escalate to the user with a clear description.
- Never downgrade a BLOCKER to WARNING to bypass this rule.

## R-QG-03: WARNING Items Require Justification

WARNING-level issues may be skipped, but only with explicit justification recorded in the sprint file.

- WARNINGs include: style violations, missing edge-case tests, minor lint warnings.
- Justification must explain why the warning is acceptable and when it will be addressed.
- Unjustified warnings are treated as BLOCKERs.

## R-QG-04: No Debug Artifacts in Production Code

The following are prohibited in production code:

- `console.log` / `console.debug` / `console.warn` (use a proper logger)
- `debugger` statements
- `print()` statements used for debugging (Python)
- Commented-out code blocks longer than 3 lines
- `TODO` or `FIXME` without an associated debt table entry

Detection is automated via the guardian `post_tool_use` event.

## R-QG-05: No Hardcoded Secrets

No hardcoded secrets, API keys, tokens, or credentials in source code.

- Use environment variables or a secrets manager.
- If a placeholder is needed, use the format `PLACEHOLDER_<SERVICE>_<TYPE>` (e.g., `PLACEHOLDER_STRIPE_API_KEY`).
- The guardian `pre_tool_use` event scans for common secret patterns before allowing commits.

## R-QG-06: Review Checklist

After each task, the orchestrator runs a review checklist:

1. Does the change match the task description?
2. Are there any regressions in existing functionality?
3. Are quality gates passing?
4. Is there new debt that needs to be tracked?
5. Are there any SUGGESTION-level improvements worth noting?

SUGGESTION items are recorded but do not block task completion.
