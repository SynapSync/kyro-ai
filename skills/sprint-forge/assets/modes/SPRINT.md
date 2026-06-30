# SPRINT Mode — Router

Lightweight index for sprint work. Do not load the full sprint protocol upfront.

## Route (on `sprint.json.handoff.nextAction`)

| nextAction | Load |
|------------|------|
| `plan_sprint` | `plan-sprint.md` |
| `execute_task` | `execute-task.md` |
| `review_task` | `review-task.md` |
| `close_sprint` / `wrap_up` | `close-sprint.md` |
| inconsistent | `recover.md` |

## Required read order

1. `.agents/kyro/kyro.json`
2. `.agents/kyro/scopes/{scope}/sprint.json` (single source of truth)
3. The routed mode file above
4. Only the helpers/templates named by that routed mode

## Invariants

- One sprint at a time; route on `handoff.nextAction`, never on file presence.
- Previous retro, recommendations, and debt feed the next sprint — all live in `sprint.json` (`ledger[]`, `previousSprint`, `debt[]`).
- Every write to `sprint.json` follows the Artifact Write Contract in `../../SKILL.md`.
- The only files that exist per scope are `sprint.json` and the write-only `archive/` + `findings/`.
