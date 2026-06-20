# Execute Task Mode

Execute the active sprint task by task while keeping writes cheap and auditable.

## Inputs

1. Read `state.json` and `index.json`.
2. Read the active `SPRINT-*.summary.json`.
3. Open the active sprint Markdown only for the current phase/task details.
4. Read `review-task.md` only when validating completed work.

## Write Policy

| Moment | Write only |
|--------|------------|
| Task close | Append a compact task event: task id, status, validation evidence, changed files, blockers, and debt deltas. |
| Phase close | Update phase status plus compact routing fields in `state.json` and `index.json`. |
| Sprint close | Leave full Markdown consolidation, summaries, debt, re-entry prompts, roadmap updates, and learned rules to `close-sprint.md`. |

Do not refresh roadmap, re-entry prompts, debt summary, or learned rules during task execution.

## Workflow

1. Set execution metadata in the sprint file when execution starts.
2. Process phases in order, and tasks in order unless dependencies require otherwise.
3. For each task, understand the task, make the smallest coherent change, run the relevant validation, correct failures, and record compact evidence.
4. Record concrete evidence as compact task events, not full rewritten retros.
5. Add an emergent phase only for required work that blocks the sprint objective or would create debt if deferred.
6. After each phase, update phase status and compact routing fields only.

## Rules

- Do not rewrite summaries after every task.
- Do not rewrite re-entry prompts, roadmap, debt summary, or rules during execution.
- Do not defer all progress tracking to sprint close; keep compact task events current.
- Do not introduce new project patterns without justification.
- If task analysis reveals the plan is wrong, return to `plan-sprint.md`.
- If correction exceeds 3 iterations, escalate: mark task `[!]` and continue to next task.
