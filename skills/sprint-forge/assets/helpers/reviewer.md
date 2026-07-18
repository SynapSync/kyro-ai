# Kyro Reviewer — Task Quality Validation

## Purpose

Provides a structured quality checklist that runs after each sprint task completes. Tasks cannot be marked as done until all BLOCKER items pass.

## Checklist Tiers

### BLOCKER (must pass — blocks task closure)

1. **Tests pass** — all related tests run successfully
2. **Type safety** — no typecheck errors introduced
3. **No debug artifacts** — no console.log, debugger, print statements in production code
4. **No secrets** — no hardcoded API keys, passwords, tokens, or credentials
5. **No broken imports** — all imports resolve correctly

### WARNING (should pass — requires justification to skip)

1. **Test coverage** — new code has test coverage
2. **Documentation** — non-obvious logic has inline comments
3. **Debt tracking** — technical debt table updated if new debt introduced
4. **Performance** — no visible performance regressions (O(n^2) loops, unbounded queries)

### SUGGESTION (noted for retro — doesn't block)

1. **Conventions** — code follows project patterns and naming conventions
2. **Refactoring opportunities** — visible DRY violations or simplification opportunities
3. **Documentation updates** — related docs should be updated

## Validation Commands

The orchestrator uses these commands to validate (adapt to project stack); keep them
bounded — scope tests, cap searches:

```bash
# Typecheck
npm run typecheck
# or: mypy, go vet

# Build
npm run build

# Tests and lint — scope to the touched files, not the whole suite.
# Run the target project's configured test/lint commands when they exist.
# Examples: pytest, go test, dart test, flutter test, ruff, golangci-lint

# Debug artifacts (capped)
grep -rn "console\.log\|debugger\|print(" src/ --include="*.ts" | head -50

# Secrets (capped)
grep -rn "apikey\|secret\|password\|token" src/ --include="*.ts" -i | head -50
```

## Output Format

```text
REVIEW: Task T{phase}.{task} — "{task title}"

BLOCKERS:          [0 found / N found]
  ✓ Tests passing
  ✓ Type safety
  ✗ Debug artifact: console.log at src/auth/login.ts:42

WARNINGS:          [0 found / N found]
  ✓ Test coverage
  ⚠ Missing documentation for validateToken()

SUGGESTIONS:       [0 found / N found]
  → Consider extracting email validation to shared util

VERDICT: PASS / FAIL (N blockers) / PASS WITH WARNINGS (N)
```
