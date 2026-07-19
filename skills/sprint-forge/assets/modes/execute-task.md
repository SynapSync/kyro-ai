# Execute Task Mode

Execute the active sprint task by task, recording evidence through the Kyro CLI.

## Inputs

1. Read the task pack, not the whole file: `{{KYRO_CLI}} context-pack --kyro-scope {scope} --task --json` — the next task self-contained (`taskDescription`, `taskFiles`, `taskContext`, `taskAcceptanceCriteria`, `taskScenarios`) plus `conventions`. Do NOT open the full `sprint.json` to execute — evidence is recorded by the CLI (step 3).
2. Work the task the pack names (respecting `depends_on`). Everything the executor needs is in the pack's task fields.

## Workflow

1. Understand the task from its self-contained fields. Make the smallest coherent change.
2. Run the validation implied by `acceptance_criteria` (tsc, lint, tests, grep, manual), **scoped to the touched area**: only the tests covering the changed files (not the full suite each round), and searches capped/scoped (`-l`, `-m N`, `| head`, or a path) — an uncapped repo-wide search floods context. Correct failures; after three failed correction rounds, mark the task `blocked` with evidence.
3. Record evidence and route with the CLI — tool-owned, never hand-edit `sprint.json` for evidence:
   `{{KYRO_CLI}} record-evidence <task-id> --kyro-scope {scope} --summary "..." --validation "<check>" [--validation ...] [--file <path> ...] [--notes "..."] [--status blocked]`
   It writes `task.evidence`, sets `task.status` (`done` by default; `blocked` after three failed rounds), and routes `handoff` to `review_task`.
4. Add an emergent task with `{{KYRO_CLI}} add-emergent --title <t> --description <d> --acceptance <a>` for required work that blocks the sprint objective or would create debt if deferred; new debt goes through `{{KYRO_CLI}} debt add`.

## Rules

- Evidence lives on the task object in `sprint.json`, written by `record-evidence`; create no other files.
- Do not write `task.verdict` as the maker. The checker verdict is tool-owned by `{{KYRO_CLI}} review`.
- Do not introduce new project patterns without justification.
- If task analysis reveals the plan is wrong, set the task `blocked`, note the mismatch, and set `handoff.nextAction: "plan_sprint"` to route back.
