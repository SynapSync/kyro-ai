# STATUS Mode — Summary-First Project Report

This mode reports progress from structured summaries first. Markdown is the fallback evidence, not the default startup context.

## Inputs

1. Read `.agents/kyro/kyro.json`.
2. Resolve scope and read `.agents/kyro/scopes/{scope}/state.json`.
3. Read `.agents/kyro/scopes/{scope}/index.json`.
4. Read summary files listed in `index.json`:
   - `ROADMAP.summary.json`
   - active or latest `SPRINT-*.summary.json`
   - `DEBT.summary.json` when present
5. Open Markdown only for missing summary fields, explicit `full` evidence, or debt mutations; `brief` never opens sprint Markdown when summaries exist.

## Report variants

| Variant | Context policy |
|---------|----------------|
| `brief` or empty | Summaries only unless a required field is missing. |
| `full` | Summaries first, then selected Markdown evidence. |
| `debt` | Debt summary first, then latest debt table if needed. |
| `debt-*` | Load `../helpers/debt-tracker.md`, mutate source Markdown, refresh summaries. |

## Metrics

Compute from summaries when available:

| Metric | Source |
|--------|--------|
| Planned/completed sprints | roadmap summary + sprint summaries |
| Task counts | sprint summaries |
| Blocked/carry-over tasks | sprint summaries |
| Open/resolved/deferred debt | debt summary or latest sprint summary |
| Roadmap adaptations | roadmap summary |
| Next action | `state.json.nextAction` and `index.json.nextTask` |

## Missing summaries

If a summary is missing:

1. Open the corresponding Markdown source.
2. Complete the report.
3. Warn that this scope needs summary refresh.
4. If mutating debt/status, write the missing summary before finishing.

## Output

For `brief`, show only:

- scope and status
- active sprint / next action
- task progress
- open debt count
- next recommended command

For `full`, include roadmap health, sprint table, debt trend, and re-entry pointer.

## Rules

- Do not read sprint Markdown for `brief` when summaries exist.
- Debt items are never deleted.
- Keep `index.json` aligned with any report mutation.
