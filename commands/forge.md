---
description: Route the Kyro forge workflow with progressive disclosure
argument-hint: <scope or request>
---

# /kyro:forge — Router

Continue Kyro work without loading the whole workflow upfront.

## Startup

1. Read `.agents/kyro/kyro.json` if it exists.
2. Resolve the active scope from `$ARGUMENTS`, `kyro.json.activeScope`, or the only directory under `.agents/kyro/scopes/`.
3. Resolve routing with `kyro context-pack --kyro-scope <scope> --json` (lean pack). Do not open the full `sprint.json`, archive Markdown, findings, templates, or helpers to route. Open the full `sprint.json` only to write, or in `plan_sprint`/`close_sprint` (see the Read Path Contract in `skills/sprint-forge/SKILL.md`).

## Route (on the pack's `nextAction`)

| Condition | Load next |
|-----------|-----------|
| No `kyro.json` | Create or validate `.agents/kyro/kyro.json`, then continue routing. |
| No `sprint.json` for the scope | `skills/sprint-forge/assets/modes/INIT.md` |
| `nextAction: "plan_sprint"` | `skills/sprint-forge/assets/modes/plan-sprint.md` |
| `nextAction: "execute_task"` | `skills/sprint-forge/assets/modes/execute-task.md` |
| `nextAction: "review_task"` | `skills/sprint-forge/assets/modes/review-task.md` |
| `nextAction: "close_sprint"` | `skills/sprint-forge/assets/modes/close-sprint.md` |
| `nextAction: "done"` | Stop — scope complete. No mode. |
| `sprint.json` missing/unparseable or inconsistent | `skills/sprint-forge/assets/modes/recover.md` |

## Rules

- Load only the routed mode plus the helpers it names; never preload sprint/debt/learner helpers.
- Enforce orchestrator gates from `agents/orchestrator.md` only at gate moments.
- Every write to `sprint.json` follows the Artifact Write Contract in `skills/sprint-forge/SKILL.md` (read → parse → mutate → overwrite whole file → re-parse).
- The only writes are `sprint.json`, `kyro.json`, and immutable `archive/` files at close.
