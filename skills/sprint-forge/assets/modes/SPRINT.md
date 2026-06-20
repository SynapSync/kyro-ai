# SPRINT Mode — Router

This file is the lightweight index for sprint work. Do not load the full sprint protocol upfront.

## Route

| Need | Load |
|------|------|
| Generate the next sprint | `plan-sprint.md` |
| Execute pending sprint tasks | `execute-task.md` |
| Validate task or phase quality | `review-task.md` |
| Close sprint, retro, debt, roadmap, re-entry | `close-sprint.md` |
| Resume interrupted or inconsistent state | `recover.md` |

## Required read order

1. `.agents/kyro/scopes/{scope}/state.json`
2. `.agents/kyro/scopes/{scope}/index.json`
3. The routed mode file above
4. Only the helpers/templates named by that routed mode

## Invariants

- One sprint at a time.
- Previous retro, recommendations, and debt feed the next sprint.
- Task completion appends compact `events.ndjson` evidence; phase close updates compact routing state.
- Full Markdown, summary, roadmap, re-entry, debt, rules, and `rules.index.json` updates happen at sprint close.
- Markdown remains evidence; JSON summaries are the routing index.
