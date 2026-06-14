# Execute Task Mode

Execute the active sprint task by task while keeping checkpoints cheap and auditable.

## Inputs

1. Read `state.json` and `index.json`.
2. Read the active `SPRINT-*.summary.json`.
3. Open the active sprint Markdown only for the current phase/task details.
4. Read `review-task.md` only when validating completed work.

## Workflow

1. Set execution metadata in the sprint file when execution starts.
2. Process phases in order, and tasks in order unless dependencies require otherwise.
3. Mark the current task `[~]`, perform the work, run verification, then mark `[x]`, `[!]`, or `[>]`.
4. Record concrete evidence inline for every task.
5. Add an emergent phase only for required work that blocks the sprint objective or would create debt if deferred.
6. After each phase, write the sprint file, refresh `SPRINT-*.summary.json`, `index.json`, and `state.json`.

## Rules

- Do not checkpoint after every task unless the task itself completes the phase.
- Do not defer all checkpointing to sprint close.
- Do not introduce new project patterns without justification.
- If implementation reveals the plan is wrong, return to `plan-sprint.md`.
