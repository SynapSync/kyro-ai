# Kyro Cost Model

Kyro is designed to stay rigorous without loading or rewriting the whole workflow on every turn.

## Default Loading

When a user says "use Kyro", the agent should load:

1. command stub and command router
2. Layered project state (`.agents/kyro/project.json` + `local.json`)
3. the scope's `sprint.json` when present
4. exactly one routed mode, selected from `sprint.json.handoff.nextAction`
5. only helpers named by that mode

It should not load the full sprint history, archived sprints, or unrelated helpers by default.

## Runtime Paths

`kyro doctor --tokens` audits realistic paths:

| Path | Budget |
|------|--------|
| `kyro-forge:init` | 5,520 estimated tokens |
| `kyro-forge:init` (seedbed-backed) | 5,860 estimated tokens |
| `kyro-forge:plan` | 5,650 estimated tokens |
| `kyro-forge:execute` | 5,070 estimated tokens |
| `kyro-forge:review` | 5,230 estimated tokens |
| `kyro-forge:close` | 6,180 estimated tokens |
| `kyro-status:brief` | 1,700 estimated tokens |
| `kyro-idea` | 5,200 estimated tokens |
| `kyro-task-context` | 2,200 estimated tokens |

Each ceiling is set 5% above the measured size at the last deliberate review, rounded up to the next multiple of 10 tokens. Growth inside that margin needs no change, and the audit prints the remaining headroom for every budget (for example `5376/5650 estimated tokens, 4.8% headroom`). Low headroom is reported, not a failure. When a route outgrows its ceiling, either move detail into a lazy-loaded helper or re-baseline that one ceiling with the same rule and say why in the changelog. Ceilings are measured with the runtime installed, so a bare checkout reads about 134 tokens lower per path.

The audit includes command stubs, routers, eager agent/skill files, routed modes, and required helpers. It also fails forbidden eager helper combinations.

## Write Policy

| Moment | Write |
|--------|-------|
| Task close | `kyro record-evidence` writes the task's evidence + status; `kyro review` writes the verdict (tool-owned, no hand-edit) |
| Phase close | update `sprint.json.handoff.nextAction` only |
| Sprint close | publish the immutable scope checkpoint, retain the verbatim ActiveSprint snapshot and narrative, then atomically reconcile live state |
| Scope retire (`done`) | no further write — human-gated terminal handoff from `scope retire` |

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
| `close` | 3,200 | deep | Sprint close and retro materialization |

`kyro context-pack` selects a class from pack mode and `sprint.json.handoff.nextAction`:

- `plan_sprint` or `status` → `brief`
- task pack or `execute_task` → `execute`
- `review_task` → `review`
- `qa_or_close` or `close_sprint` → `close`
- `done` → `brief` (terminal; emitted only by retirement)

The selected class appears in context-pack output as `budgetClass`, `reasoningTier`, `maxContextTokens`, and `budgetGuidance`.

Fixture validation:

```bash
npm run check:budget-manifest
```

## Quality Boundary

Kyro is not less rigorous. It moves rigor to the correct lifecycle boundary: compact evidence during execution, full documentation and learning at sprint close.
