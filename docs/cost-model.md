# Kyro Cost Model

Kyro is designed to stay rigorous without loading or rewriting the whole workflow on every turn.

## Default Loading

When a user says "use Kyro", the agent should load:

1. command stub and command router
2. `.agents/kyro/kyro.json`
3. the scope's `sprint.json` when present
4. exactly one routed mode, selected from `sprint.json.handoff.nextAction`
5. only helpers named by that mode

It should not load the full sprint history, archived sprints, or unrelated helpers by default.

## Runtime Paths

`kyro doctor --tokens` audits realistic paths:

| Path | Budget |
|------|--------|
| `kyro-forge:init` | 3,500 estimated tokens |
| `kyro-forge:plan` | 3,000 estimated tokens |
| `kyro-forge:execute` | 2,500 estimated tokens |
| `kyro-forge:review` | 2,500 estimated tokens |
| `kyro-forge:close` | 3,200 estimated tokens |
| `kyro-status:brief` | 1,500 estimated tokens |
| `kyro-wrap-up` | 3,200 estimated tokens |

The audit includes command stubs, routers, eager agent/skill files, routed modes, and required helpers. It also fails forbidden eager helper combinations.

## Write Policy

| Moment | Write |
|--------|-------|
| Task close | record compact evidence directly on the task object in `sprint.json` |
| Phase close | update `sprint.json.handoff.nextAction` only |
| Sprint close | write the verbatim snapshot plus human narrative to `archive/`, then clear the active sprint block in `sprint.json` |
| Wrap-up | update `sprint.json.handoff` with final context for the next session |

This keeps work recoverable without rewriting large artifacts after every task.

## Conventions and Debt

Conventions and technical debt are tracked as fields on `sprint.json`, not as separate files. Startup reads `sprint.json` once; there is no separate rules index to keep in sync.

## Budget Classes

`config.json` defines provider-neutral budget classes. They describe how much context to load and how deep to reason — without naming provider-specific models.

| Class | Max context tokens | Reasoning tier | Typical use |
|-------|-------------------|----------------|-------------|
| `brief` | 1,500 | light | Status, routing, summary-first resume |
| `execute` | 2,500 | standard | Implementation and task execution |
| `review` | 2,500 | standard | Review, certification, regression checks |
| `close` | 3,200 | deep | Sprint close, retro, wrap-up materialization |

`kyro context-pack` selects a class from pack mode and `sprint.json.handoff.nextAction`:

- `plan_sprint` or `status` → `brief`
- task pack or `execute_task` → `execute`
- `review_task` → `review`
- `close_sprint` or `wrap_up` → `close`

The selected class appears in context-pack output as `budgetClass`, `reasoningTier`, `maxContextTokens`, and `budgetGuidance`.

Fixture validation:

```bash
npm run check:budget-manifest
npm run check:context-pack
```

## Quality Boundary

Kyro is not less rigorous. It moves rigor to the correct lifecycle boundary: compact evidence during execution, full documentation and learning at sprint close.
