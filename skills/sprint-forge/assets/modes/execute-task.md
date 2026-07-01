# Execute Task Mode

Execute the active sprint task by task, recording evidence directly into `sprint.json`.

## Inputs

1. Read `.agents/kyro/scopes/{scope}/sprint.json`.
2. Work the task identified by `handoff.nextTaskId` (or the first `pending` task in phase order, respecting `depends_on`). Everything the executor needs is in the task object: `description`, `files_to_touch`, `context`, `acceptance_criteria`.

## Workflow

1. Understand the task from its self-contained fields. Make the smallest coherent change.
2. Run the validation implied by `acceptance_criteria` (tsc, lint, tests, grep, manual). Correct failures; after three failed correction rounds, mark the task `blocked` with evidence.
3. Record evidence on the task object and advance routing — all via the Artifact Write Contract in `../../SKILL.md`:
   - Set `task.evidence = { summary, validation, files_changed: [...], notes }`.
   - Set `task.status = "done"` (or `"blocked"`).
   - Set `handoff.nextTaskId` to the next pending task, and `handoff.nextAction` to `"review_task"` when the task needs validation or `"close_sprint"` when all tasks are done and verdicted.
4. Add an emergent task to `activeSprint.emergentTasks[]` only for required work that blocks the sprint objective or would create debt if deferred. New debt goes to `debt[]` as an object.

## Rules

- One safe-write per task transition; never partial-edit the JSON.
- Evidence lives on the task object in `sprint.json`; create no other files.
- Do not introduce new project patterns without justification.
- If task analysis reveals the plan is wrong, set the task `blocked`, note the mismatch, and set `handoff.nextAction: "plan_sprint"` to route back.
