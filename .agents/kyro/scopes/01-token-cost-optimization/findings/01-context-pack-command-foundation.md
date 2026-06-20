# Finding 01 — Context-pack command foundation is missing

## Summary
Kyro has realistic token audits and summary-first routers, but no deterministic CLI command that emits the minimal context package an agent should load for a scope.

## Severity
P1 — cost and reliability improvement.

## Affected files or modules
- `src/cli/app.ts`
- `src/cli/options.ts`
- `src/cli/commands/context-pack.ts` (new)
- `src/cli/artifacts/*`
- `docs/cli.md`
- `docs/context-management.md`

## User-visible behavior
Users and agents should be able to run `kyro context-pack --kyro-scope <scope>` and receive a summary-first context bundle with scope status, next action, relevant summaries, artifact paths, warnings, and estimated token cost.

## Details
Today, command routers describe what to read, but the agent still performs file selection manually. This keeps context minimization as discipline rather than product behavior.

## Recommendation
Add a `context-pack` command routed from `runCli`, parse `--kyro-scope`, and emit text plus `--json` output. Start with scope/status packs before task-specific packs.

## Validation
- Fixture/golden output for a valid scope.
- Missing-scope and missing-summary warnings.
- `npm run check` and targeted context-pack fixture test.
