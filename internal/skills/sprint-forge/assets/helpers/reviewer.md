# Kyro Reviewer — Task Quality Validation

A task is not done until every BLOCKER passes.

## Checklist Tiers

### BLOCKER (blocks task closure)

1. **Tests pass** — task-tier checks pass (`../protocols/validation.md`)
2. **Type safety** — no typecheck errors introduced
3. **No debug artifacts** — no console.log, debugger, print statements in production code
4. **No secrets** — no hardcoded API keys, passwords, tokens, or credentials
5. **No broken imports** — all imports resolve correctly

### WARNING (justify to skip)

1. **Test coverage** for new code
2. **Documentation** for non-obvious logic
3. **Debt tracking** — new debt registered
4. **Performance** — no visible regressions (O(n^2) loops, unbounded queries)

### SUGGESTION (retro only)

Conventions, refactoring opportunities, related doc updates.

## Output Format

```text
REVIEW: Task T{phase}.{task} — "{task title}"
BLOCKERS: [0 / N]   ✓ Tests passing  ✗ Debug artifact: console.log at src/auth/login.ts:42
WARNINGS: [0 / N]   ⚠ Missing documentation for validateToken()
SUGGESTIONS: [0 / N] → Extract email validation to a shared util
VERDICT: PASS / FAIL (N blockers) / PASS WITH WARNINGS (N)
```
