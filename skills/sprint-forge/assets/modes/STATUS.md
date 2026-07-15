# STATUS Mode — Project Report from sprint.json

Report progress from the single source of truth. One read, no summaries.

## Inputs

1. Read `.agents/kyro/kyro.json`.
2. Resolve scope and read `.agents/kyro/scopes/{scope}/sprint.json`. Everything is in that one file.

## Report variants

| Variant | Content |
|---------|---------|
| `brief` or empty | scope + status, active sprint + next action (`handoff`), task progress, open debt count, next recommended command. |
| `full` | roadmap health, sprint table (from `roadmap` + `ledger[]`), debt trend (`debt[]`), ADR summary/recent ADRs (`adrs[]`), recommendations from the latest `ledger[]` entry. |
| `debt` | `debt[]` grouped by status; oldest open item; critical count. |
| `debt-*` | Load `../helpers/debt-tracker.md`, then mutate `sprint.json.debt[]` via the Artifact Write Contract. |

## Metrics (all computed from sprint.json)

| Metric | Source |
|--------|--------|
| Planned / closed sprints | `roadmap.sprints` + `ledger[]` |
| Task counts (total/done/blocked/carry-over) | `activeSprint.phases[].tasks` |
| Open / in_progress / resolved / deferred debt | `debt[]` |
| ADR totals by status and recent decisions | `adrs[]` |
| Review debt (done tasks without a `pass` verdict) | `activeSprint.phases[].tasks` + `emergentTasks` where `status === 'done'` and `verdict?.result !== 'pass'` |
| Next action | `handoff.nextAction` + `handoff.nextTaskId` |

## Output

- `brief`: scope, status, active sprint, next action, task progress, open debt count, review debt count, next command.
- `full`: add roadmap health, sprint table, debt trend, review-debt task ids, ADR summary/recent ADRs, and the resume note from `handoff.note`.

`context-pack` exposes the same review debt as `reviewPending` (and `nextTaskReview` for a task pack);
prefer those fields when reporting from a pack rather than recomputing.
There is no standalone CLI `status` subcommand; this mode backs the `/kyro:status` slash command.

## Health check (optional)

For a deeper read than counts, run `{{KYRO_CLI}} analyze --kyro-scope {scope}` — it surfaces clarity,
coverage, dependency, and overdue-debt issues with severity. Read-only.

## Rules

- A report is read-only unless an explicit `debt-*` mutation is requested.
- Debt items are never deleted; only `status` changes.
- One read of `sprint.json`; no other files.
