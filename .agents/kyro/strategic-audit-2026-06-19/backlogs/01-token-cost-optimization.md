# Backlog: Token and Cost Optimization

Kyro now uses much stronger progressive disclosure after the lean runtime refactor. Eager runtime instructions are slim, helper loading is route-specific, and `doctor --tokens` audits realistic adapter paths. The remaining step is to make minimal task context a deterministic CLI product.

## Current status

**Status:** PARTIAL. Completed work includes slim `agents/orchestrator.md`, slim `skills/sprint-forge/SKILL.md`, lazy protocol files, route-specific helper loading assertions, realistic runtime path budgets, compact `events.ndjson` evidence support, `rules.index.json`, and `docs/cost-model.md`. Pending work centers on `kyro context-pack`, model routing, and context-pack regression fixtures.

## Evidence

- Command routers are small and summary-first.
- `doctor --tokens` checks budgets for command routers, eager runtime assets, modes, helpers, templates, projected skills, startup path, INIT path, and realistic forge/status/wrap-up adapter paths.
- Runtime paths assert forbidden helper combinations, including AD3C absence from Kyro runtime.
- Routers still tell agents what to read, but there is no CLI-generated context pack for a scope/task.
- Lifecycle prose was reduced in eager runtime files, but docs still need long-term drift discipline.

## Technical correction

Keep deterministic runtime budgeting and add context-pack generation. The agent should receive a small, task-specific bundle before opening long Markdown evidence.

## Tasks

| ID | Priority | Size | Task | Likely files | Acceptance criteria | Validation |
|----|----------|------|------|--------------|---------------------|------------|
| TCO-001 | P1 | M | Implement `kyro context-pack --kyro-scope <scope>` | `src/cli/app.ts`, `src/cli/options.ts`, `src/cli/commands/context-pack.ts`, `src/cli/artifacts/*` | Command emits scope, next action, active sprint, relevant summaries, paths, and missing evidence warnings | Fixture command output test |
| TCO-002 | P1 | M | Add task-specific context pack mode | same as TCO-001 | `--task <id>` includes only active task details, touched files, verification criteria, and relevant rules | Fixture with active sprint task |
| TCO-003 | PARTIAL | S | Add token estimate to context pack output | `src/cli/commands/token-audit.ts`, context-pack command | Runtime path estimates exist; context-pack output still needs estimates | Golden fixture test |
| TCO-004 | DONE | S | Deduplicate repeated gate/router prose | `agents/orchestrator.md`, `skills/sprint-forge/SKILL.md`, `docs/*` | Eager runtime files are slim and lazy protocols hold details | `npm run check:tokens` passes |
| TCO-005 | P2 | M | Add model routing manifest | `config.json`, `src/cli/types.ts`, docs | Task types map to budget class and suggested model tier without provider-specific names | Schema/fixture validation |
| TCO-006 | P2 | M | Add context budget regression fixtures | `fixtures/context-pack/**`, `scripts/check-context-pack-fixtures.mjs` | Known scopes produce bounded context packs | `npm run check:context-pack-fixtures` |

## Success metrics

| Metric | Target |
|--------|--------|
| Brief status path | `kyro-status:brief` ≤ 1,500 estimated tokens; current validation passes |
| Active execute path | `kyro-forge:execute` ≤ 2,500 estimated tokens; current validation passes |
| Context packs | Pending: brief under 2k and active task under 4k unless explicitly full |
| Router startup path | No regression against current `doctor --tokens` budgets |
| Repeated full Markdown reads | Reduced by summaries, `rules.index.json`, and compact events; further reduced once context packs exist |
