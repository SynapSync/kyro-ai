---
description: Route Kyro status and debt reports from structured summaries first
argument-hint: [brief|full|debt|debt-add|debt-resolve|debt-escalate]
---

# /kyro:status — Router

Report Kyro progress without loading all sprint Markdown by default.

## Startup

1. Read `.agents/kyro/kyro.json`.
2. Resolve scope from `$ARGUMENTS`, `activeScope`, or `.agents/kyro/scopes/`.
3. Read `.agents/kyro/scopes/{scope}/state.json` and `index.json` first.
4. Prefer `ROADMAP.summary.json`, `SPRINT-*.summary.json`, and `DEBT.summary.json` when present.

## Route

| Request | Load next |
|---------|-----------|
| `brief` or empty | Summaries only; open Markdown only for missing critical fields. |
| `full` | `skills/sprint-forge/assets/modes/STATUS.md`, then summaries, then Markdown fallbacks. |
| `debt` | `skills/sprint-forge/assets/helpers/debt-tracker.md` plus debt summary/table. |
| `debt-add`, `debt-resolve`, `debt-escalate` | `debt-tracker.md`, then update Markdown and summaries. |

## Missing summaries

If a summary file is missing, fall back to the Markdown source, produce the requested report, and mention that `kyro doctor --tokens` will report the missing optimization.

## Rules

- Do not read every sprint file for `brief` when summaries exist.
- Never delete debt items; only update status fields.
- Keep `index.json` aligned with any status or debt mutation.
