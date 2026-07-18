# Execute Task Mode

Execute the active sprint task by task, recording evidence directly into `sprint.json`.

## Inputs

1. Read the task pack, not the whole file: `{{KYRO_CLI}} context-pack --kyro-scope {scope} --task --json` — the next task self-contained (`taskDescription`, `taskFiles`, `taskContext`, `taskAcceptanceCriteria`, `taskScenarios`) plus `conventions`. Do NOT open the full `sprint.json` to execute; you open it once at write time (step 3).
2. Work the task the pack names (respecting `depends_on`). Everything the executor needs is in the pack's task fields.

## Workflow

1. Understand the task from its self-contained fields. Make the smallest coherent change.
2. Run the validation implied by `acceptance_criteria` (tsc, lint, tests, grep, manual). Correct failures; after three failed correction rounds, mark the task `blocked` with evidence.
3. Record evidence on the task object and advance routing — all via the Artifact Write Contract in `../../SKILL.md`:
   - Set `task.evidence = { summary, validation, files_changed: [...], notes, by, recordedAt }`.
   - Set `task.status = "done"` (or `"blocked"`).
   - Set `handoff.nextTaskId` to this task, and `handoff.nextAction` to `"review_task"` when the task needs validation.
4. Add an emergent task to `activeSprint.emergentTasks[]` only for required work that blocks the sprint objective or would create debt if deferred. New debt goes to `debt[]` as an object.

## Rules

- One safe-write per task transition; never partial-edit the JSON.
- Evidence lives on the task object in `sprint.json`; create no other files.
- Do not write `task.verdict` as the maker. The checker verdict is tool-owned by `{{KYRO_CLI}} review`.
- Do not introduce new project patterns without justification.
- If task analysis reveals the plan is wrong, set the task `blocked`, note the mismatch, and set `handoff.nextAction: "plan_sprint"` to route back.
