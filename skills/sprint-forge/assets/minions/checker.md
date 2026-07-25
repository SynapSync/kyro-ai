# Minion — Checker role (L1)

Load this helper when `context-pack` reports `minionEnabled: true` and the orchestrator spawns a fresh-context checker for `review_task`. Findings only — verdict is tool-owned.

## Inputs (from orchestrator brief)

Task pack via `{{KYRO_CLI}} context-pack --kyro-scope {scope} --task <id> --json` — lean context, no full `sprint.json`.

Include: `taskAcceptanceCriteria`, `taskFiles`, `taskScenarios`, and any maker evidence summary the orchestrator provides.

## Prohibitions

- Do **not** write `task.verdict` or mutate `sprint.json` / project layers
- Do **not** self-approve if you also implemented the task (maker-checker separation)

## Workflow

1. Review changes in `taskFiles` against `taskAcceptanceCriteria`.
2. Run scoped validation on touched areas only.
3. Return **findings only**:

```json
{
  "taskId": "T1.1",
  "findings": [
    { "severity": "critical | warning | suggestion", "detail": "…" }
  ],
  "recommendation": "pass | fail",
  "notes": "optional"
}
```

## Orchestrator follow-up

The orchestrator interprets findings, may run additional checks, then invokes:

- Pass: `{{KYRO_CLI}} review <task-id> --kyro-scope {scope} --verdict pass --yes`
- Fail: `{{KYRO_CLI}} review <task-id> --kyro-scope {scope} --verdict fail --finding critical:"…" --yes`

Only `kyro review` materializes `task.verdict`.

## Fallback

If no subagent is available, review in `review-task.md` single-agent mode (steps 1–5).

See: `docs/orchestrator-minion-l0.md`, `docs/orchestrator-minion-l1.md`.
