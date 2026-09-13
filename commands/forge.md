---
description: "Route Kyro sprint work: plan, execute, review, close a sprint, or complete a finished scope. Not for obsolete or superseded scopes."
argument-hint: <scope or request>
---

# /kyro:forge — Router

Continue Kyro work without loading the whole workflow upfront.

## Startup

1. Read `.agents/kyro/project.json` + `.agents/kyro/local.json` if they exist. Unreadable/corrupt → stop here.
2. Resolve the active scope from `$ARGUMENTS`, `local.json.activeScope`, or the only directory under `.agents/kyro/scopes/`. Ambiguous or none → ask the user before continuing.
3. A scope that does not exist yet — neither in `project.json` nor on disk — is creation, not corruption: skip `repair` and `context-pack`, load `skills/sprint-forge/assets/modes/INIT.md`, and never route it to recovery.
4. Only for an existing scope, silently run `{{KYRO_CLI}} repair integrity prepare --kyro-scope <scope> --json` *before* `context-pack`. Never omit `--kyro-scope` — it isolates this scope from unrelated drift. Findings/blockers → load `skills/sprint-forge/assets/modes/recover.md` and stop. None → discard and continue; do not ask.
5. Resolve routing with `kyro context-pack --kyro-scope <scope> --json` (lean pack). Do not open the full `sprint.json`, archive Markdown, findings, templates, or helpers to route. Open the full `sprint.json` only to write, or in `plan_sprint`/`close_sprint`.

## User intent (before `nextAction`)

`$ARGUMENTS` is intent, not only a scope id. Apply this overlay first.

- **Complete / close / finish the scope**, objective met, no more sprints, "cierre del scope": this is **completion**, not retirement.
  1. Preview `{{KYRO_CLI}} scope complete --kyro-scope <scope>` (no `--yes`).
  2. Confirm completion (reopenable) — not another sprint, not marking it obsolete.
  3. After yes, run the same command with `--yes`. Stop.
  4. Do not load plan-sprint. Forge never retires.
- **Obsolete / superseded / discarded** (irreversible): STOP. That is the operator-only `kyro-scope-retire` router.
- Otherwise route on `nextAction` below.

## Route (on the pack's `nextAction`)

| Condition | Load next |
|-----------|-----------|
| No project state | Validate `.agents/kyro/project.json` + `local.json`; if absent, tell the user to run install, then continue routing. |
| No `sprint.json` for the scope | `skills/sprint-forge/assets/modes/INIT.md` |
| `nextAction: "clarify"` | `skills/sprint-forge/assets/modes/clarify.md` |
| `nextAction: "plan_sprint"` | `skills/sprint-forge/assets/modes/plan-sprint.md` |
| `nextAction: "await_scope_completion"` | Ask: complete the finished scope, or explicitly expand it. Complete → `scope complete`; expand → then route as `plan_sprint`. |
| `nextAction: "execute_task"` | `skills/sprint-forge/assets/modes/execute-task.md` |
| `nextAction: "review_task"` | `skills/sprint-forge/assets/modes/review-task.md` |
| `nextAction: "qa_or_close"` | `skills/sprint-forge/assets/modes/qa-or-close.md` |
| `nextAction: "close_sprint"` | `skills/sprint-forge/assets/modes/close-sprint.md` |
| `nextAction: "done"` | Stop — already complete or retired. No mode. |
| `sprint.json` missing/unparseable or inconsistent | `skills/sprint-forge/assets/modes/recover.md` |

## Rules

- Load only the routed mode plus the helpers it names; never preload sprint/debt/learner helpers.
- Enforce orchestrator gates from `agents/orchestrator.md` only at gate moments.
- Kyro-managed state writes use their dedicated CLI verb. In particular, clarification decisions use `kyro clarify --from <file>`; never read/parse/write `sprint.json` from the agent.
- Register Kyro rules with `kyro rule add` (ask whether also global); never create `RULES.md` or hand-edit conventions.
- Kyro-managed state writes use the CLI; immutable `archive/` files are created only at close.
