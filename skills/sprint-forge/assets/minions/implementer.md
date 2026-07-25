# Minion — Implementer role (L1)

Load this helper when `context-pack` reports `minionEnabled: true` and the orchestrator delegates the current task to a worker. The orchestrator builds the brief; this helper defines how the worker executes and reports.

## Inputs (from orchestrator brief)

Built from `{{KYRO_CLI}} context-pack --kyro-scope {scope} --task <id> --json` — **not** the full `sprint.json`.

| Field | Source |
|-------|--------|
| `taskId`, title, description | Task pack |
| `files_to_touch` | Task pack |
| `acceptance_criteria` | Task pack |
| Scope conventions | Task pack |
| Expected validation | Derived from acceptance criteria |

## Prohibitions (non-negotiable)

- Do **not** mutate `sprint.json`, `project.json`, `local.json`, or `kyro.json`
- Do **not** run `close-sprint`, `plan`, or hand-edit `evidence` / `verdict`
- Do **not** replan the sprint or rewrite roadmap

## Workflow

1. Implement the smallest coherent change that satisfies acceptance criteria.
2. Run validation scoped to touched files (tests, lint, tsc — as implied by AC).
3. Return a **final status checkpoint** to the orchestrator (required):

```json
{
  "taskId": "T1.1",
  "status": "in_progress | blocked | done",
  "summary": "What was done or why blocked",
  "filesChanged": ["path/..."],
  "validation": {
    "ran": true,
    "command": "npm test -- …",
    "ok": true,
    "notes": "optional"
  },
  "blockers": [],
  "notes": "optional"
}
```

## Status → orchestrator mapping

| Worker `status` | Orchestrator action |
|-----------------|---------------------|
| `in_progress` | Log only; do not mark task done |
| `blocked` | `record-evidence … --status blocked` |
| `done` + `validation.ok` | Orchestrator verifies, then `record-evidence` → `review_task` |
| `done` weak | Reject; re-brief or fix — do not invent evidence |

The orchestrator (not the worker) invokes `{{KYRO_CLI}} record-evidence` and advances handoff.

## Fallback

If you are the orchestrator running without a spawnable subagent, execute the task yourself per `execute-task.md` (single-agent path). Never fail the forge because minions are unavailable.

See: `docs/architecture.md`, `docs/context-management.md`, `docs/maker-checker.md`.
