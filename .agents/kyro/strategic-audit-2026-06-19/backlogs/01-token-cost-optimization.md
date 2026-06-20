# Backlog: Token and Cost Optimization

Kyro already uses progressive disclosure, but context selection still depends too much on agent discipline. The next step is to make minimal context a deterministic CLI product.

## Evidence

- Command routers are small and summary-first.
- `doctor --tokens` checks budgets for command routers, modes, helpers, templates, projected skills, startup path, and INIT path.
- Routers tell agents what to read, but there is no CLI-generated context pack for a scope/task.
- Some lifecycle concepts are repeated across `agents/orchestrator.md`, `skills/sprint-forge/SKILL.md`, and docs.

## Technical correction

Add deterministic context budgeting and context-pack generation. The agent should receive a small, task-specific bundle before opening long Markdown evidence.

## Tasks

| ID | Priority | Size | Task | Likely files | Acceptance criteria | Validation |
|----|----------|------|------|--------------|---------------------|------------|
| TCO-001 | P1 | M | Implement `kyro context-pack --kyro-scope <scope>` | `src/cli/app.ts`, `src/cli/options.ts`, `src/cli/commands/context-pack.ts`, `src/cli/artifacts/*` | Command emits scope, next action, active sprint, relevant summaries, paths, and missing evidence warnings | Fixture command output test |
| TCO-002 | P1 | M | Add task-specific context pack mode | same as TCO-001 | `--task <id>` includes only active task details, touched files, verification criteria, and relevant rules | Fixture with active sprint task |
| TCO-003 | P1 | S | Add token estimate to context pack output | `src/cli/commands/token-audit.ts`, context-pack command | Output includes estimated words/tokens by section and total budget status | Golden fixture test |
| TCO-004 | P1 | S | Deduplicate repeated gate/router prose | `agents/orchestrator.md`, `skills/sprint-forge/SKILL.md`, `docs/*` | Canonical source is identified; repeated docs link or summarize instead of duplicating full rules | `npm run check:tokens` does not regress |
| TCO-005 | P2 | M | Add model routing manifest | `config.json`, `src/cli/types.ts`, docs | Task types map to budget class and suggested model tier without provider-specific names | Schema/fixture validation |
| TCO-006 | P2 | M | Add context budget regression fixtures | `fixtures/context-pack/**`, `scripts/check-context-pack-fixtures.mjs` | Known scopes produce bounded context packs | `npm run check:context-pack-fixtures` |

## Success metrics

| Metric | Target |
|--------|--------|
| Brief status context pack | Under 2k estimated tokens |
| Active task context pack | Under 4k estimated tokens unless explicitly full |
| Router startup path | No regression against current `doctor --tokens` budgets |
| Repeated full Markdown reads | Reduced by using summaries/context packs first |
