---
description: Report Kyro progress and debt from sprint.json
argument-hint: [brief|full|debt|debt-add|debt-resolve|debt-escalate]
---

# /kyro:status — Router

Report Kyro progress from the single source of truth.

## Startup

1. Read `.agents/kyro/kyro.json`.
2. Resolve scope from `$ARGUMENTS`, `kyro.json.activeScope`, or `.agents/kyro/scopes/`.
3. For `brief` (or empty), read the lean scope pack `kyro context-pack --kyro-scope <scope> --json` — it carries `status`, `activeSprintSlug`, `nextAction`, `openDebtCount`, and `reviewPending`. Open the full `sprint.json` only for `full`/`debt` reports, which need `roadmap`/`ledger[]`/`activeSprint`/`debt[]`/`adrs[]` (see the Read Path Contract in `skills/sprint-forge/SKILL.md`).

## Route

| Request | Load next |
|---------|-----------|
| `brief` or empty | Report directly from `sprint.json`; include review debt count (`done` tasks without a `pass` verdict). |
| `full` | `skills/sprint-forge/assets/modes/STATUS.md` for the detailed report shape, including review-debt task ids and ADR summary/recent ADRs. |
| `debt` | Report `debt[]` from `sprint.json`; load `skills/sprint-forge/assets/helpers/debt-tracker.md` only to explain status semantics. |
| `debt-add`, `debt-resolve`, `debt-escalate` | `skills/sprint-forge/assets/helpers/debt-tracker.md`, then mutate `sprint.json.debt[]` via the Artifact Write Contract. |

## Rules

- A status report is read-only unless an explicit `debt-*` mutation is requested.
- Debt items are never deleted; only their `status` changes.
- Debt mutations follow the Artifact Write Contract in `skills/sprint-forge/SKILL.md`.
- When reporting from a context pack, prefer `reviewPending` / `nextTaskReview`; otherwise compute review debt from `activeSprint.phases[].tasks` plus `emergentTasks`.
