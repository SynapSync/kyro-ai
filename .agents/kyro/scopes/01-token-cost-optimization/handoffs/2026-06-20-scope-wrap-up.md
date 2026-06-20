# Handoff — 01-token-cost-optimization Scope Wrap-Up

Date: 2026-06-20
Scope: 01-token-cost-optimization
Status: completed
Version shipped: 3.4.3

## Scope State

- **Roadmap**: 3 sprints planned, 3 completed
- **Active sprint**: none
- **Open debt**: 0 (1 deferred: D1 prose `nextTask` mapping)
- **Next action**: scope complete — ready for commit/PR

## Completed Work

### Sprint 1 — Context-pack CLI Foundation

- Added `kyro context-pack --kyro-scope <scope> [--json]`.
- Reads `state.json`, `index.json`, `ROADMAP.summary.json`, `rules.index.json`.
- Emits summary-first scope packs with warnings and estimated token totals.
- Added `scripts/check-context-pack-fixtures.mjs` and `fixtures/context-pack/valid-demo.json`.

### Sprint 2 — Task-specific Packs and Budget Fixtures

- Added `--task <id>` and bare `--task` (defaults to `index.nextTask` when `T{n}.{m}`).
- Implemented `src/cli/artifacts/task-parser.ts` for sprint Markdown task blocks.
- Task packs filter rules to `execute-task` / `review-task` and list evidence paths without embedding Markdown bodies.
- Added `task-demo.json`, `budgets.json`, and budget regression assertions in fixture checker.

### Sprint 3 — Budget Routing Manifest

- Encoded provider-neutral `budgetClasses` in `config.json` (`brief`, `execute`, `review`, `close`).
- Added `src/cli/budget-manifest.ts` with loader and selection by `packMode` / `nextAction`.
- Extended `ContextPackOutput` with `budgetClass`, `reasoningTier`, `maxContextTokens`, `budgetGuidance`.
- Added `scripts/check-budget-manifest.mjs` and `fixtures/context-pack/budget-manifest.json`.
- Wired `check:context-pack` and `check:budget-manifest` into CI and `npm run check`.
- Bumped version to **3.4.3** with synced plugin and WORKFLOW metadata.

## Mental Context

### Decisions Made

- Budget classes are provider-neutral policy hints, not model IDs. Selection follows Kyro lifecycle (`wrap_up` → `close`, `execute_task` → `execute`).
- `listScopeNames` / `listScopeFolders` live in `src/cli/artifacts/scopes.ts` and are shared by doctor, scope, and context-pack.
- Fixture checkers must pass `--json` explicitly; golden snapshots normalize `estimatedTokens` to `"number"`.
- Sprint close for final roadmap sprint sets `status: completed` and `nextAction: wrap_up` before session handoff.

### Corrections Applied

- Avoided `kyro repair` after sprint close — it corrupted `state.json` and summaries in Sprint 1; restore manually instead.
- Scope packs during `execute_task` map to budget class `execute`, not `brief` — documented in Sprint 3 retro and cost-model docs.
- `index.nextTask` may be prose during planning; bare `--task` fallback requires `T{n}.{m}` task ids (deferred as D1).

### Rules Established

- See `.agents/kyro/scopes/rules.md` (Context Pack and Token Cost sections) and `rules.index.json`.

## Files Context

### Source / Config Changes

- `src/cli/commands/context-pack.ts` — scope and task pack command
- `src/cli/budget-manifest.ts` — budget class loader and routing
- `src/cli/artifacts/task-parser.ts` — sprint Markdown task extraction
- `src/cli/artifacts/scopes.ts` — shared scope listing
- `config.json` — `budgetClasses` manifest
- `scripts/check-context-pack-fixtures.mjs`, `scripts/check-budget-manifest.mjs`
- `fixtures/context-pack/*` — golden snapshots and budget ceilings

### Documentation Changes

- `docs/cli.md`, `docs/context-management.md`, `docs/commands-reference.md`
- `docs/cost-model.md` — budget class table and selection rules
- `docs/release-checklist.md` — context-pack and budget-manifest gates

### Kyro Artifacts Updated

- `.agents/kyro/scopes/01-token-cost-optimization/state.json` — `status: completed`
- `.agents/kyro/scopes/01-token-cost-optimization/index.json` — no active sprint, no open debt
- `.agents/kyro/scopes/01-token-cost-optimization/ROADMAP.summary.json` — 3/3 sprints completed
- `.agents/kyro/scopes/01-token-cost-optimization/DEBT.summary.json` — 0 open, 1 deferred
- `.agents/kyro/scopes/01-token-cost-optimization/RE-ENTRY-PROMPTS.md` — scope completed
- `.agents/kyro/scopes/01-token-cost-optimization/events.ndjson` — 10 events including wrap-up

## Validation at Close

All gates pass:

```bash
npm run check
npm run check:context-pack
npm run check:budget-manifest
npm run check:artifact-fixtures
npm run check:tokens
node dist/cli.js doctor --artifacts --kyro-scope 01-token-cost-optimization
```

## Recommended Next Action

1. Review uncommitted changes with `git status`.
2. Stage and commit the token-cost-optimization work (v3.4.3).
3. Open a pull request for review.
4. After merge, start the next Kyro scope or archive `01-token-cost-optimization` if no follow-up work is planned.

## Notes

- Pre-existing WARN: `check:tokens` reports missing Codex AGENTS block (non-blocking).
- Deferred debt D1: map prose `index.nextTask` to sprint task ids for `--task` fallback.
- Many new files are untracked (`??`) — include scope folder, fixtures, and new `src/` modules in the commit.