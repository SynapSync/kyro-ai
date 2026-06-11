# Code Review Reference

Use this reference when reviewing implementation diffs, pull requests, or task completion.

## Review Order

1. Confirm the change matches the stated task.
2. Look for behavioral regressions before style issues.
3. Check error handling, input validation, and edge cases.
4. Confirm tests or manual verification evidence match the risk.
5. Verify no debug artifacts or hardcoded secrets remain.

## Severity

| Severity | Meaning |
|----------|---------|
| BLOCKER | Must be fixed before approval |
| WARNING | Can ship only with explicit justification |
| SUGGESTION | Non-blocking improvement for retro/debt tracking |

## Output Shape

Lead with findings, ordered by severity. Each finding must cite the file and explain impact. If there are no findings, say so clearly and list remaining verification gaps.
