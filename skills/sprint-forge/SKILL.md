---
name: sprint-forge
description: >
  Adaptive sprint workflow with a single source of truth per scope (sprint.json),
  lean context loading, formal debt tracking, and lossless sprint-close checkpoints.
license: Apache-2.0
metadata:
  author: synapsync
  version: "4.0"
  scope: [root]
  auto_invoke:
    - "Analyze project or codebase"
    - "Audit code quality or architecture"
    - "Create a roadmap for a project"
    - "Generate the next sprint"
    - "Execute a sprint"
    - "Check project status or progress"
    - "Review technical debt"
    - "Analiza el proyecto o codebase"
    - "Audita la calidad o arquitectura del código"
    - "Crea un roadmap para el proyecto"
    - "Genera el siguiente sprint"
    - "Ejecuta el sprint"
    - "Estado del proyecto o progreso"
    - "Revisa la deuda técnica"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Task
---

# Kyro Sprint Forge — Runtime Contract (v4)

One scope = one `sprint.json`. Agents read `kyro.json` + the scope's lean pack, then route on `nextAction`. No other agent-facing files.

## Core Invariants

1. `sprint.json` is the single source of truth; one file to update per action (see Read Path Contract).
2. Route on the pack's `nextAction` (mirrors `handoff.nextAction`); never infer from file presence.
3. Generate one sprint; never pre-generate.
4. Tasks are self-contained: every task carries `description`, `files_to_touch`, `context`, `acceptance_criteria`.
5. Debt never disappears; it only changes `status` (`open → in_progress → resolved | deferred`).
6. Closing a sprint is owned by `{{KYRO_CLI}} close-sprint` — never null `activeSprint` by hand; it becomes one `ledger[]` entry.
7. Findings/archives are write-only evidence; never re-read to route.
8. **Admit unknowns, never guess.** Write `[NEEDS CLARIFICATION: <gap>]` and route to `clarify`. `{{KYRO_CLI}} doctor`/`analyze` FAIL while any marker remains.
9. **Tool-owned verbs require a CLI that exposes them** (Startup handshake). A missing verb means the runtime is too old — abort; never fall back by hand.

## Read Path Contract (context-pack first) — MANDATORY

The full `sprint.json` is ~10–20k tokens. Never open it to route/execute/review or brief status — read the lean pack (`{{KYRO_CLI}} context-pack --kyro-scope <scope> --json`; `--task[ <id>]` for execute/review). Open the full file only to write or in `plan_sprint`/`close_sprint`/status-full (invariant 7).

## Artifact Write Contract (MANDATORY)

Every mutation of `sprint.json` or `kyro.json` MUST be a **safe write**:

> Read the whole file → `JSON.parse` → mutate the object → serialize → overwrite in one write → re-parse to confirm. If the re-parse fails, restore and report.

NEVER partial/string-replace structural changes (nulling `activeSprint`, removing a nested block) — it orphans and corrupts the JSON. Exception: the archive snapshot (fresh file, pure write).

## Tool-owned operations (use the CLI, do not hand-roll)

Irreversible or schema-critical operations are CLI-owned, never hand-rolled:

| Command | What it owns |
|---------|--------------|
| `{{KYRO_CLI}} close-sprint --kyro-scope <scope> --outcome <...>` | Lossless close: publishes the checkpoint, snapshots into `ledger[]`, reconciles state. |
| `{{KYRO_CLI}} doctor --artifacts --kyro-scope <scope>` | Validates shape drift, checkpoint state/digests/artifacts, legacy snapshots, and unresolved `[NEEDS CLARIFICATION]`. |
| `{{KYRO_CLI}} analyze --kyro-scope <scope>` | Semantic cross-check (clarity, coverage, deps, debt, principles); non-zero on CRITICAL/HIGH. Gate before close. |
| `{{KYRO_CLI}} repair --kyro-scope <scope>` | Normalizes `sprint.json` formatting. |

Claude Code's `PreToolUse` hook blocks edits nulling `activeSprint`; others rely on this contract.

## Routing (handoff.nextAction → mode)

| nextAction | Load |
|------------|------|
| `init` (no sprint.json) | `modes/INIT.md` + one `helpers/analysis/{workType}.md` |
| `clarify` | `modes/clarify.md` |
| `plan_sprint` | `modes/SPRINT.md`, `modes/plan-sprint.md`, then `helpers/sprint-generator.md` |
| `execute_task` | `modes/SPRINT.md`, `modes/execute-task.md` |
| `review_task` | `modes/SPRINT.md`, `modes/review-task.md`, `helpers/reviewer.md` |
| `close_sprint` | `modes/SPRINT.md`, `modes/close-sprint.md`, `helpers/debt-tracker.md` + `helpers/learner.md` as needed |
| `done` | Stop — scope complete. No work mode. |
| status report | `modes/STATUS.md` |
| inconsistent | `modes/recover.md` |

Templates are loaded only immediately before writing their artifact.

## Principles, conventions, ADRs

- `principles[]` in `kyro.json`: authored gates; `non-negotiable` blocks. Checked in `{{KYRO_CLI}} analyze`; free-text gates apply in review.
- `conventions[]` in `sprint.json`: operational learned rules from retros/corrections; fold into task context.
- `adrs[]` in `sprint.json`: durable scope-local architecture decisions with context/tradeoffs.

## Artifact Contract

| File | Role |
|------|------|
| `.agents/kyro/kyro.json` | Global registry: `scopes[]`, `activeScope`, optional `principles[]` |
| `.agents/kyro/scopes/{scope}/sprint.json` | Single source of truth (see template) |
| `.agents/kyro/scopes/{scope}/archive/sprint-NNN-slug.md` | Human narrative at close (write-only) |
| `.agents/kyro/scopes/{scope}/archive/sprint-NNN-slug.json` | Verbatim snapshot of the closed sprint (write-only) |
| `.agents/kyro/scopes/{scope}/archive/sprint-NNN-slug.checkpoint.json` | Versioned lossless checkpoint (before/after state, write-only) |
| `.agents/kyro/scopes/{scope}/findings/NN-slug.md` | INIT analysis evidence (write-only) |

## Boundaries

- INIT is read-only against source code until it writes Kyro artifacts.
- Execution may modify code/docs but must validate touched areas before marking a task done.
- STATUS is read-only unless explicitly mutating debt status.
- Recover preserves user archives and rebuilds `sprint.json` from the best evidence.
