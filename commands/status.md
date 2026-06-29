---
description: Report Kyro progress and debt from sprint.json
argument-hint: [brief|full|debt|debt-add|debt-resolve|debt-escalate]
---

# /kyro:status — Router

Report Kyro progress from the single source of truth.

## Startup

1. Read `.agents/kyro/kyro.json`.
2. Resolve scope from `$ARGUMENTS`, `kyro.json.activeScope`, or `.agents/kyro/scopes/`.
3. Read the scope's `sprint.json`. Everything needed for a report — `roadmap`, `ledger[]`, `activeSprint`, `debt[]`, `conventions[]`, `handoff` — is in that one file.

## Route

| Request | Load next |
|---------|-----------|
| `brief` or empty | Report directly from `sprint.json`; no extra files. |
| `full` | `skills/sprint-forge/assets/modes/STATUS.md` for the detailed report shape. |
| `debt` | Report `debt[]` from `sprint.json`; load `skills/sprint-forge/assets/helpers/debt-tracker.md` only to explain status semantics. |
| `debt-add`, `debt-resolve`, `debt-escalate` | `skills/sprint-forge/assets/helpers/debt-tracker.md`, then mutate `sprint.json.debt[]` via the Artifact Write Contract. |

## Rules

- A status report is read-only unless an explicit `debt-*` mutation is requested.
- Debt items are never deleted; only their `status` changes.
- Debt mutations follow the Artifact Write Contract in `skills/sprint-forge/SKILL.md`.
