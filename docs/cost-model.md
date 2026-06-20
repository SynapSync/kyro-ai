# Kyro Cost Model

Kyro is designed to stay rigorous without loading or rewriting the whole workflow on every turn.

## Default Loading

When a user says "use Kyro", the agent should load:

1. command stub and command router
2. `.agents/kyro/kyro.json`
3. scoped `state.json`, `index.json`, and `rules.index.json` when present
4. exactly one routed mode
5. only helpers named by that mode

It should not load roadmap Markdown, every sprint file, debt helpers, re-entry helpers, or full rules Markdown by default.

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
| Task close | append one compact event to `events.ndjson` |
| Phase close | update compact routing state only |
| Sprint close | materialize Markdown, summaries, debt, roadmap, re-entry prompts, and rules |
| Wrap-up | handoff plus final re-entry context |

This keeps work recoverable without rewriting large artifacts after every task.

## Rules Loading

Startup reads `rules.index.json`, not full `rules.md`. Open `rules.md` only when a matching rule may apply, the user asks for rules, or sprint close proposes new rules.

## Budget Classes

`config.json` defines provider-neutral budget classes. They describe how much context to load and how deep to reason — without naming provider-specific models.

| Class | Max context tokens | Reasoning tier | Typical use |
|-------|-------------------|----------------|-------------|
| `brief` | 1,500 | light | Status, routing, summary-first resume |
| `execute` | 2,500 | standard | Implementation and task execution |
| `review` | 2,500 | standard | Review, certification, regression checks |
| `close` | 3,200 | deep | Sprint close, retro, wrap-up materialization |

`kyro context-pack` selects a class from pack mode and `state.json` `nextAction`:

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
