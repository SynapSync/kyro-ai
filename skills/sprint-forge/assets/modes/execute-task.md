# Execute Task Mode

Execute the active sprint task, recording evidence through the Kyro CLI.

## Inputs

1. Read the task pack: `{{KYRO_CLI}} context-pack --kyro-scope {scope} --task --json` — self-contained next task (`taskDescription`, `taskFiles`, `taskContext`, `taskAcceptanceCriteria`, `taskScenarios`) plus `conventions`. Do NOT open full `sprint.json` to execute; the CLI records evidence (step 3).
2. Work the pack's task (respect `depends_on`). All executor inputs are in the pack.

## Workflow

1. Understand the task from its fields. Make the smallest coherent change.
2. Validate per `acceptance_criteria` (tsc, lint, tests, grep, manual), **scoped to the touched area**: only tests for changed files; cap searches (`-l`, `-m N`, `| head`, or a path). After three failed correction rounds, mark `blocked` with evidence.
3. Record evidence via CLI — never hand-edit `sprint.json`:
   `{{KYRO_CLI}} record-evidence <task-id> --kyro-scope {scope} --summary "..." --validation "<check>" [--validation ...] [--file <path> ...] [--notes "..."] [--status blocked]`
   Writes `task.evidence`, sets `task.status` (`done` default; `blocked` after three failed rounds), routes `handoff` to `review_task`.
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
- If the CLI rejects `record-evidence` as unknown, the runtime is too old: ABORT the forge, report `{{KYRO_CLI}} --version`, and request an upgrade. Hand-writing evidence is never a permitted fallback.
- Do not write `task.verdict` as the maker — tool-owned by `{{KYRO_CLI}} review`.
- Do not invent project patterns without justification.
- If the plan is wrong, block the task, note the mismatch, set `handoff.nextAction: "plan_sprint"`.
