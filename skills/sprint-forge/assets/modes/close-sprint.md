# Close Sprint Mode

Close a sprint or session by materializing compact execution evidence into durable documentation.

## Inputs

1. Read `state.json`, `index.json`, active sprint summary, and `events.ndjson` if present.
2. Read summary files before opening Markdown.
3. Open active sprint Markdown only when materializing retro, findings, debt, or Definition of Done.
4. Read `../helpers/debt-tracker.md` before changing debt rows.
5. Read `../helpers/reentry-generator.md` only before updating re-entry prompts.
6. Load roadmap Markdown only if execution changed future sprint sequencing.

## Workflow

1. Run the pre-close quality checkpoint.
2. Consolidate findings from planned and emergent phases using compact task events first.
3. Fill retro: went well, did not go well, surprises, new debt.
4. Write recommendations for Sprint N+1.
5. Update accumulated debt statuses and new debt rows.
6. Verify Definition of Done.
7. Update re-entry prompts and roadmap only when needed.
8. Refresh `state.json`, `index.json`, active sprint summary, and debt summary.
9. Propose learned rules and refresh `rules.index.json` when `rules.md` changes.

## Rules

- Retro must be honest and specific.
- Re-entry context must point to the next action.
- Markdown is the durable evidence; summaries are the routing cache.
- This is the only normal sprint phase that refreshes full summaries, re-entry prompts, roadmap changes, debt summary, and learned rules.
