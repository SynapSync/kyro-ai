# Helper — Delegated execution (L0/L1/L2)

Load **only** when the user opts into delegation or `context-pack` reports `delegationEnabled: true`. Keep single-agent execute/review as the default path.

## L1 routing

| Mode | Load |
|------|------|
| `execute_task` | `../delegates/implementer.md` |
| `review_task` | `../delegates/checker.md` |

If the host cannot spawn a subagent, fall back to single-agent mode steps — never fail the forge.

## When to use

- User explicitly requests a worker/subagent for the current task
- L1 flag on: `local.json` `execution.delegationEnabled: true` → pack shows `delegationEnabled: true`
- Orchestrator chooses a large, well-bounded task (still opt-in, never default for every task)
- Review: maker-checker separation, independent second opinion, or high-risk task

## Orchestrator brief (execute)

Source from the task pack (`context-pack --task`), **not** the full `sprint.json`:

| Field | Source |
|-------|--------|
| `taskId`, title, description | Task pack |
| `files_to_touch` / paths | Task pack |
| `acceptance_criteria` | Task pack |
| Scope conventions | Task pack `conventions` |
| Expected validation | Derived from acceptance criteria |
| **Prohibitions** | Worker must NOT mutate `sprint.json` / project layers; must NOT run `close-sprint`, `plan`, or hand-edit evidence/verdict |

Pass only what the worker needs.

## Status → CLI (execute)

Implementer returns status JSON (see `implementer.md`). Orchestrator maps:

| Worker `status` | Action |
|-----------------|--------|
| `in_progress` | Log only; do not mark done or advance handoff |
| `blocked` | `record-evidence … --status blocked`; do not advance |
| `done` + `validation.ok` | Verify tree, then `record-evidence` → `review_task` |
| `done` weak / no validation | Reject; re-brief — do **not** invent evidence |

Worker dies mid-run: re-read tree + task state, re-brief (idempotent).

## Checker findings (review)

Checker returns findings only (see `checker.md`). Orchestrator interprets, may re-check, then:

- Pass: `{{KYRO_CLI}} review <id> --kyro-scope {scope} --verdict pass --yes`
- Fail: `{{KYRO_CLI}} review <id> --kyro-scope {scope} --verdict fail --finding critical:"…" --yes`

Same implementer must not be the checker when maker-checker policy applies. Only `{{KYRO_CLI}} review` writes `task.verdict`.

## Write matrix

| Actor | May | Must not |
|-------|-----|----------|
| **Orchestrator** | Build brief, spawn/skip worker, interpret status, invoke CLI, advance handoff | Cede SoT ownership to the worker |
| **Delegate** | Edit product code (or review), run local checks, return status/findings JSON | Mutate workflow state; self-approve |
| **Kyro CLI** | Canonical writes (`record-evidence`, `review`, …) | — |

## Phase UX

"Run the phase with delegates" means the **orchestrator loops** ready tasks (`brief → delegate → apply → CLI`). One delegate never owns the phase or sprint.

## L2 tmux host (optional)

Process isolation / non-IDE agent CLI — consumer-repo launcher, not a Kyro verb:

| Layer | Pattern |
|-------|---------|
| L0/L1 | In-process subagent or single-agent |
| L2 | tmux (or similar) + agent CLI + status JSON file |

Flow: `{{KYRO_CLI}} context-pack --task <id> --json` → launcher spawns agent → delegate writes `runs/<taskId>-status.json` → orchestrator applies via CLI only.

See: `docs/architecture.md`, `docs/context-management.md`, `docs/maker-checker.md`, `docs/teams.md`.
