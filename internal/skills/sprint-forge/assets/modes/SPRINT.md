# SPRINT Mode — Router

Lightweight index for sprint work. Do not load the full sprint protocol upfront.

## Route (on `sprint.json.handoff.nextAction`)

| nextAction | Load |
|------------|------|
| `clarify` | `clarify.md` |
| `plan_sprint` | `plan-sprint.md` |
| `execute_task` | `execute-task.md` |
| `review_task` | `review-task.md` |
| `close_sprint` | `close-sprint.md` |
| `done` | Stop — scope complete. No mode. |
| inconsistent | `recover.md` |

## Required read order

1. `.agents/kyro/project.json` + `.agents/kyro/local.json`
2. The lean pack (`{{KYRO_CLI}} context-pack`; `--task` for execute/review) — never the full `sprint.json` to route. Full file only for planning/close context, per the Read Path Contract in `../../SKILL.md`.
3. The routed mode file above
4. Only the helpers/templates named by that routed mode

## Invariants

- One sprint at a time; never route on file presence.
- Previous retro, recommendations, and debt feed the next sprint — all live in `sprint.json` (`ledger[]`, `previousSprint`, `debt[]`).
- Every `sprint.json` mutation is performed by a tool-owned CLI verb.
- The only files that exist per scope are `sprint.json` and the write-only `archive/` + `findings/`.
