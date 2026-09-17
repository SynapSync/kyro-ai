# Execute Task Mode

Execute the active sprint task, recording evidence through the Kyro CLI.

## Inputs

1. Read the self-contained task pack: `{{KYRO_CLI}} context-pack --kyro-scope {scope} --task --json`. Do NOT open full `sprint.json`; the CLI records evidence (step 3).
2. Work the pack's task (respect `depends_on`).

## Workflow

For a `remedyCommand` blocker, load `../helpers/live-work.md`, follow it, then resume from its refreshed pack.

1. Understand the task from its fields. Make the smallest coherent change.
2. Validate per `acceptance_criteria` (tsc, lint, tests, grep, manual), **scoped to the touched area**: only tests for changed files; cap searches (`-l`, `-m N`, `| head`, or a path). After three failed correction rounds, mark `blocked` with evidence.
3. Record evidence via CLI — never hand-edit `sprint.json`:
   `{{KYRO_CLI}} record-evidence <task-id> --kyro-scope {scope} --summary "..." --validation "<check>" [--validation ...] [--file <path> ...] [--notes "..."] [--status blocked] [--disposition deferred|superseded|cancelled --reason "..." [--target debt:<id>|task:<id>|sprint:<n>]]`
   `done` routes that task to `review_task`. Temporary `blocked` skips review; inspect `context-pack.execution` and continue only ready independent work. Dependents stay pending but computed blocked. Resume with fresh `done` evidence, then review. Terminal dispositions are deferred/superseded/cancelled; legacy `--disposition blocked` is read-only.
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
- Active definition correction: load `../helpers/live-work.md`, then `../helpers/active-plan-update.md`; use `plan --update-active`.
- Implementation-only correction: fail review, then re-execute, record evidence, and review the same task.

## Telling the user how to continue

**There is no CLI verb that executes a task.** Execution is yours; the CLI only records the result
(`record-evidence`) and the verdict (`review`).
There is no `execute` verb and no `execute_task` verb — `execute_task` is a `handoff.nextAction`
value, not a command. Agents have shipped both in closing summaries; each exits `UNKNOWN_COMMAND`
and sends the user down a dead end.

When you finish, hand back one of these and nothing else:

- More work in this sprint → “Run `/kyro:forge` to continue with `<nextTaskId>`.”
- Sprint tasks finished → “Run `/kyro:forge` to choose `kyro qa` or close Sprint `<n>`.”
- Want the state → “Run `/kyro:status`.”

Never compose a `{{KYRO_CLI}}` line for the user unless you have run that exact verb yourself in this
session and it succeeded.
