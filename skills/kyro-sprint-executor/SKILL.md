---
name: kyro-sprint-executor
description: >
  Manual-only. Strict end-to-end Kyro sprint execution: capability handshake,
  per-task context-pack → implement → validate → record-evidence → review,
  fail-closed on missing CLI verbs, user-approved sprint close. Invoke
  explicitly when executing a Kyro sprint outside the full forge workflow.
license: Apache-2.0
metadata:
  author: synapsync
  version: "2.0"
  scope: [root]
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# Kyro Sprint Executor — Strict Sprint Execution

Execute the active Kyro sprint exclusively through the Kyro CLI. All state lives in `sprint.json`; every state write goes through a tool-owned verb. You never hand-edit Kyro-managed state — no exception exists.

## Step 0 — Capability handshake (MANDATORY, once per session)

**First, resolve `{{KYRO_CLI}}` if it hasn't been substituted.** This token is normally replaced at install time by `npx kyro-ai install`/`sync`. Since this skill is explicitly designed for external hosts that may load it standalone (never having run that installer), the literal characters `{{KYRO_CLI}}` may still be present below — resolve once per session, before anything else: try `kyro --version`; if that exits 0, use bare `kyro` for the rest of this session. Else check whether `~/.agents/kyro/current/dist/cli.js` exists and use `node ~/.agents/kyro/current/dist/cli.js`. Else Kyro's runtime is not installed on this machine — STOP, tell the user to run `npx kyro-ai@latest install --scope workspace --init-workspace --yes` once, then retry. This is not a license to hand-edit `sprint.json` or improvise — same rule as a missing verb below.

Run `{{KYRO_CLI}} capabilities --json`.

- If the command is unknown, or `record-evidence`/`review` are absent from the list, the installed runtime is too old for this skill. **ABORT**: report `{{KYRO_CLI}} --version` output and ask the user to upgrade. There is NO manual fallback.

## Step 1 — Route

Run `{{KYRO_CLI}} context-pack --kyro-scope <scope> --json` and obey `nextAction`:

| nextAction | Do |
|------------|----|
| `execute_task` | Step 2 (task loop) |
| `review_task` | Step 2, stage 5 (review the pending task) |
| `clarify` | STOP — resolve every `[NEEDS CLARIFICATION: <gap>]` with the user first; `record-evidence`/`review` refuse while markers remain (`CLARIFICATION_REQUIRED`) |
| `plan_sprint` / `close_sprint` | See Sprint close below for `close_sprint`; planning is not this skill's job — report and stop |
| `done` | Scope complete — report and stop |

Never infer routing from file presence. Never open the full `sprint.json` to route.

## Step 2 — Task loop (repeat until routing leaves `execute_task`/`review_task`)

1. **Pack**: `{{KYRO_CLI}} context-pack --kyro-scope <scope> --task --json` — the task is self-contained (`taskDescription`, `taskFiles`, `taskContext`, `taskAcceptanceCriteria`, `conventions`). Respect `depends_on`.
2. **Implement**: the smallest coherent change that satisfies the acceptance criteria, following the pack's conventions. Do not invent project patterns without justification.
3. **Validate**, scoped to the touched area: run the checks the acceptance criteria imply (typecheck, lint, targeted tests, capped searches). Only tests for changed files; cap searches (`-l`, `-m N`, `| head`, or a path).
4. **Record evidence** (maker):
   `{{KYRO_CLI}} record-evidence <task-id> --kyro-scope <scope> --summary "..." --validation "<check>" [--validation ...] [--file <path> ...] [--notes "..."]`
   - **No `--yes`/`--confirm` here** — those flags belong to `review`; passing them fails with `INVALID_INPUT`.
   - After **three** failed correction rounds: rerun with `--status blocked`, then stop and report — do not grind further.
5. **Review** (checker):
   - Pass: `{{KYRO_CLI}} review <task-id> --kyro-scope <scope> --verdict pass [--by <actor>] --yes`
   - Fail: `{{KYRO_CLI}} review <task-id> --kyro-scope <scope> --verdict fail --finding critical:"..." --yes`
   - `--dry-run` and `--yes` are mutually exclusive.
   - The CLI vetoes a pass on missing/malformed evidence, unchecked acceptance criteria, tampered timestamps, non-negotiable principle violations, or self-review policy (`CHECKER_FAILED`, `SELF_REVIEW_BLOCKED`). A veto is a blocking finding: return to stage 2 and fix the cause. Never argue with, retry unchanged, or route around the checker.
6. Re-run Step 1 to route to the next task. One task at a time — never run stages in parallel, never skip or reorder them.

## Emergent work and debt

- Required work discovered mid-sprint: `{{KYRO_CLI}} add-emergent --title <t> --description <d> --acceptance <a> [--acceptance ...] --kyro-scope <scope>` — the new task then enters the same task loop.
- Non-blocking issues: `{{KYRO_CLI}} debt add --title "..." --priority <critical|high|medium|low> --kyro-scope <scope>`. Debt never disappears; only its status changes.

## Rule registration

When the user asks to register, save, or remember a rule **with Kyro**, interpret it as a scope convention, never as a Markdown file:

1. Resolve the active scope through `context-pack` or `scope list`; do not invent a destination.
2. Propose a specific actionable rule and appropriate tags.
3. Ask whether the rule should also be persisted globally for every Kyro scope. If the user already said scope-only or global, do not ask again.
4. Scope only: `{{KYRO_CLI}} rule add --rule "<rule>" --tag <tag> --kyro-scope <scope>`.
5. Scope + global: run the same command with `--global` only after explicit confirmation. Kyro writes scope `sprint.json.conventions[]` and shared `project.json.conventions[]`; future `context-pack` calls inherit the global rule.

Never create `RULES.md`, `rules.md`, or another rule artifact. If `rule` is missing from `capabilities`, abort and request a runtime upgrade; never hand-edit Kyro state.

## Sprint close (USER GATE)

When routing reports `close_sprint`:

1. Verify completeness with `{{KYRO_CLI}} status full --kyro-scope <scope>`: no pending tasks, no missing evidence or verdicts, no unresolved critical findings.
2. **Ask the user for explicit approval.** Closing a sprint is a lifecycle gate — never proceed past it on your own.
3. On approval: `{{KYRO_CLI}} close-sprint --kyro-scope <scope> --yes`. Never null `activeSprint` by hand. Confirm the CLI reports a successful close.

## Hard rules (non-negotiable)

- Never hand-edit `sprint.json`, `project.json`, evidence, verdicts, conventions, or any Kyro-managed state.
- If any tool-owned verb fails as an unknown command, the runtime is too old: ABORT and report the version (Step 0). A missing verb is never a license to improvise.
- Never fabricate, backdate, or adjust `recordedAt`/`reviewedAt` — the CLI stamps its own clocks and the checker vetoes tampering.
- On any CLI refusal (`INVALID_INPUT`, `CHECKER_FAILED`, `CLARIFICATION_REQUIRED`, ...): read the `Remedy:` line and follow it exactly. Do not retry unchanged; do not route around it.
- Never close a partially completed sprint; never mark a task complete without tool-recorded evidence and a `pass` verdict.

## Final report

Per task: id, validations run and their results, evidence summary, final verdict, and correction rounds (if any). For the sprint: emergent tasks and debt added, close result, and explicit confirmation that every state write went through the CLI.
