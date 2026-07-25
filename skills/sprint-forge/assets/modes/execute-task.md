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

## Opt-in minion execution (L0)

**Default:** execute as a single agent (steps 1–3 above). **Opt-in:** when the user asks to run the current task with a minion/worker/subagent, delegate implementation to a worker and keep workflow ownership.

### When to use

- User explicitly requests minion execution (e.g. "run this task with a minion").
- Orchestrator chooses delegation for a large, well-bounded task — still opt-in, never the default for every task.

### Minion brief (orchestrator builds; worker receives)

Source the brief from the task pack (`context-pack --task`), **not** the full `sprint.json`. Include at minimum:

| Field | Source |
|-------|--------|
| `taskId`, title, description | Task pack |
| `files_to_touch` / relevant paths | Task pack |
| `acceptance_criteria` | Task pack |
| Scope conventions | Task pack `conventions` |
| Expected validation command(s) | Derived from acceptance criteria |
| **Prohibitions** | Worker must NOT mutate `sprint.json`, `project.json`, `local.json`, or `kyro.json`; must NOT run `close-sprint`, `plan`, or hand-edit evidence/verdict |

Pass only what the worker needs. Do not dump the full sprint or unrelated scope context.

### Minion status contract (worker → orchestrator)

The worker **must** return a final status checkpoint when its turn ends (mid-run progress is optional if the host supports it):

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

| Worker `status` | Orchestrator action |
|-----------------|---------------------|
| `in_progress` | Log only; do **not** mark task done or advance handoff |
| `blocked` | `record-evidence … --status blocked`; do not advance to the next task |
| `done` + `validation.ok` | Verify changes, then `record-evidence` → `review_task` |
| `done` weak / no validation | Reject; re-brief or fix — do **not** invent evidence |

If the worker dies mid-run: re-read the working tree and task state, then re-brief (idempotent).

### Write matrix (L0)

| Actor | May | Must not |
|-------|-----|----------|
| **Orchestrator** | Build brief, spawn/skip worker, interpret status, invoke CLI, advance handoff | Cede SoT ownership to the worker |
| **Minion** | Edit product code, run local validation, return status JSON | Mutate workflow state files; self-approve review |
| **Kyro CLI** | Canonical workflow writes (`record-evidence`, `review`, …) | — |

### Phase UX with minions

"Run the phase with minions" means: **orchestrator loops** ready tasks in the phase (`for each task → brief → minion → apply status → CLI`). It does **not** mean one minion owns the phase or sprint.

### Fallback when subagents are unavailable

If the host cannot spawn a worker (no Task/subagent tool, spawn fails, or user did not opt in): **fall back silently** to the single-agent workflow (steps 1–3). Never block the forge because minions are unavailable.

See also: `docs/orchestrator-minion-l0.md`.

## Rules

- Evidence lives on the task object in `sprint.json`, written by `record-evidence`; create no other files.
- Do not write `task.verdict` as the maker. The checker verdict is tool-owned by `{{KYRO_CLI}} review`.
- Do not introduce new project patterns without justification.
- If task analysis reveals the plan is wrong, set the task `blocked`, note the mismatch, and set `handoff.nextAction: "plan_sprint"` to route back.
