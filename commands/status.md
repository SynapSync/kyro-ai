---
description: Report Kyro progress and debt from sprint.json
argument-hint: [brief|full|debt|debt-add|debt-resolve|debt-escalate]
---

# /kyro:status — Router

Report Kyro progress from the single source of truth.

## Startup

1. Read `.agents/kyro/project.json` + `.agents/kyro/local.json`.
2. Resolve scope from `$ARGUMENTS`, `local.json.activeScope`, or `.agents/kyro/scopes/`.
3. For `brief` (or empty), read the lean scope pack `kyro context-pack --kyro-scope <scope> --json` — it carries `status`, `activeSprintSlug`, `nextAction`, `openDebtCount`, and `reviewPending`. Open the full `sprint.json` only for `full`/`debt` reports, which need `roadmap`/`ledger[]`/`activeSprint`/`debt[]`/`adrs[]` (see the Read Path Contract in `skills/sprint-forge/SKILL.md`).

## Route

| Request | Load next |
|---------|-----------|
| `brief` or empty | Report directly from `sprint.json`; include review debt count (`done` tasks without a `pass` verdict). |
| `full` | `skills/sprint-forge/assets/modes/STATUS.md` for the detailed report shape, including review-debt task ids and ADR summary/recent ADRs. |
| `debt` | Report `debt[]` from `sprint.json`; load `skills/sprint-forge/assets/helpers/debt-tracker.md` only to explain status semantics. |
| `debt-add`, `debt-resolve`, `debt-escalate` | Load `skills/sprint-forge/assets/helpers/debt-tracker.md`, then run the matching `kyro debt` verb. |

## Rules

- A status report is read-only unless an explicit `debt-*` mutation is requested.
- Debt items are never deleted; only their `status` changes.
- Debt mutations are CLI-owned; a missing runtime or verb stops without mutation.
- When reporting from a context pack, prefer `reviewPending` / `nextTaskReview`; otherwise compute review debt from `activeSprint.phases[].tasks` plus `emergentTasks`.
