# Execute Task Mode

Execute the active sprint task, recording evidence through the Kyro CLI.

## Inputs

1. Read the task pack: `{{KYRO_CLI}} context-pack --kyro-scope {scope} --task --json` — self-contained next task (`taskDescription`, `taskFiles`, `taskContext`, `taskAcceptanceCriteria`, `taskScenarios`) plus `conventions`. Do NOT open full `sprint.json` to execute; the CLI records evidence (step 3).
2. Work the pack's task (respect `depends_on`). All executor inputs are in the pack.

## Workflow

1. Understand the task from its fields. Make the smallest coherent change.
2. Validate per `acceptance_criteria` (tsc, lint, tests, grep, manual), **scoped to the touched area**: only tests for changed files; cap searches (`-l`, `-m N`, `| head`, or a path). After three failed correction rounds, mark `blocked` with evidence.
3. Record evidence via CLI — never hand-edit `sprint.json`:
   `{{KYRO_CLI}} record-evidence <task-id> --kyro-scope {scope} --summary "..." --validation "<check>" [--validation ...] [--file <path> ...] [--notes "..."] [--status blocked] [--disposition deferred|blocked|superseded|cancelled --reason "..." [--target debt:<id>|task:<id>|sprint:<n>]]`
   Writes `task.evidence`. Without `--disposition`, sets `task.status` (`done` default; `blocked` after three failed rounds) and routes `handoff` to `review_task`. With `--disposition`, records unfinished work as deferred/blocked/superseded/cancelled (never `done`/`pass`) and keeps routing on `execute_task`.
   **No `--yes` here** — that flag is for `review` (and similar confirm verbs), not `record-evidence`.
4. Emergent work: `{{KYRO_CLI}} add-emergent --title <t> --description <d> --acceptance <a>` when it blocks the objective; new debt via `{{KYRO_CLI}} debt add`.

## Opt-in delegated execution

**Default:** steps 1–3. **Opt-in** when the user asks to delegate or pack `delegationEnabled: true`:

1. **Must load** `../helpers/delegated-execution.md` and `../delegates/implementer.md` before spawning.
2. Brief from the task pack only. Worker returns status JSON; **only the orchestrator** runs `record-evidence`.
3. Worker must not edit `sprint.json`, invent evidence, or run plan/close/review CLI.
4. Weak/`done` without validation → re-brief; do not invent evidence. No subagent → steps 1–3 (never block the forge).

## Rules

- Evidence is written only by `record-evidence`; create no other evidence files.
- Unknown `record-evidence` command → runtime too old: ABORT (Startup handshake). Never hand-write evidence.
- Do not write `task.verdict` as the maker — tool-owned by `{{KYRO_CLI}} review`.
- Do not invent project patterns without justification.
- If the plan is wrong, block the task, note the mismatch, set `handoff.nextAction: "plan_sprint"`.

## Telling the user how to continue

**There is no CLI verb that executes a task.** Execution is yours; the CLI only records the result
(`record-evidence`) and the verdict (`review`).
There is no `execute` verb and no `execute_task` verb — `execute_task` is a `handoff.nextAction`
value, not a command. Agents have shipped both in closing summaries; each exits `UNKNOWN_COMMAND`
and sends the user down a dead end.

When you finish, hand back one of these and nothing else:

- More work in this sprint → “Run `/kyro:forge` to continue with `<nextTaskId>`.”
- Sprint finished → “Run `/kyro:forge` to close Sprint `<n>`.”
- Want the state → “Run `/kyro:status`.”

Never compose a `{{KYRO_CLI}}` line for the user unless you have run that exact verb yourself in this
session and it succeeded.
