# Close Sprint Mode

Close a sprint or session by updating only the artifacts required for handoff and learning.

## Inputs

1. Read `state.json`, `index.json`, and active sprint summary.
2. Open active sprint Markdown for retro, findings consolidation, debt, and Definition of Done.
3. Read `../helpers/debt-tracker.md` before changing debt rows.
4. Read `../helpers/reentry-generator.md` only before updating re-entry prompts.
5. Load roadmap Markdown only if execution changed future sprint sequencing.

## Workflow

1. Run the pre-close quality checkpoint.
2. Consolidate findings from planned and emergent phases.
3. Fill retro: went well, did not go well, surprises, new debt.
4. Write recommendations for Sprint N+1.
5. Update accumulated debt statuses and new debt rows.
6. Verify Definition of Done.
7. Update re-entry prompts and roadmap only when needed.
8. Refresh `state.json`, `index.json`, active sprint summary, and debt summary.
9. Propose learned rules for `.agents/kyro/scopes/rules.md`.

## Rules

- Retro must be honest and specific.
- Re-entry context must point to the next action.
- Markdown is the durable evidence; summaries are the routing cache.
