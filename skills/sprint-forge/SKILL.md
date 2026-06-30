---
name: sprint-forge
description: >
  Adaptive sprint workflow with a single source of truth per scope (sprint.json),
  lean context loading, formal debt tracking, and zero-loss sprint-close archival.
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

One scope = one `sprint.json`. Agents read `kyro.json` (global registry) and the scope's `sprint.json`, then route on `handoff.nextAction`. There are no other agent-facing files.

## Core Invariants

1. `sprint.json` is the single source of truth. Two reads to start (`kyro.json` + `sprint.json`), one file to update per action.
2. Route on `sprint.json.handoff.nextAction` — never infer state from file presence.
3. Generate one sprint at a time; never pre-generate future sprints.
4. Tasks are self-contained: every task carries `description`, `files_to_touch`, `context`, `acceptance_criteria`.
5. Debt never disappears; it only changes `status` (`open → in_progress → resolved | deferred`).
6. At sprint close, the destructive snapshot-then-clear of `activeSprint` is owned by the `kyro close-sprint` CLI — never hand-edit `sprint.json` to null `activeSprint`. The closed sprint becomes one `ledger[]` entry.
7. Findings and archives are write-only human evidence; agents never re-read them to route.
8. **Admit unknowns, never guess.** When a detail that affects design/data/tasks/tests is unknown, write `[NEEDS CLARIFICATION: <what is missing>]` in the relevant field instead of inventing an answer, and route to `clarify`. `kyro doctor`/`kyro analyze` FAIL while any such marker remains — it is a deterministic gate, not a suggestion.

## Artifact Write Contract (MANDATORY)

Every mutation of `sprint.json` or `kyro.json` MUST be a **safe write**:

> Read the whole file → `JSON.parse` to an in-memory object → mutate the object → serialize → overwrite the entire file in one write → re-read and parse once to confirm validity. If the re-parse fails, restore and report.

NEVER use a partial/string-replace edit for structural changes (e.g. setting `activeSprint` to `null`, removing a nested block). A surgical string edit on a large JSON orphans the body and corrupts the single source of truth. The only exception is the per-sprint archive snapshot (`archive/sprint-NNN-slug.json`) — a fresh file, pure write, never re-read.

## Tool-owned operations (use the CLI, do not hand-roll)

Some operations are irreversible or schema-critical. The CLI does them deterministically — invoke it instead of editing JSON by hand:

| Command | What it owns |
|---------|--------------|
| `kyro close-sprint --kyro-scope <scope> --outcome <...>` | The zero-loss close: snapshots `activeSprint` to `archive/` **before** clearing it, renders the narrative `.md` deterministically (title from `roadmap.sprints[]`, never `undefined`), appends the `ledger[]` entry, sets `previousSprint`/`roadmap` state/`handoff`, flips `kyro.json` scope status. Refuses on double-close. |
| `kyro migrate --kyro-scope <scope>` | Upgrades a v3 scope to a v4 `sprint.json`. |
| `kyro doctor --artifacts --kyro-scope <scope>` | Validates artifact integrity (shape drift, missing snapshots, unresolved `[NEEDS CLARIFICATION]`, v3 leakage). |
| `kyro analyze --kyro-scope <scope>` | Semantic cross-check (clarity, coverage, dependencies, overdue debt, principles). Severity-triaged; exits non-zero on CRITICAL/HIGH. Gate before `close_sprint`. |
| `kyro repair --kyro-scope <scope>` | Validates and normalizes `sprint.json` formatting. |

In Claude Code, a `PreToolUse` hook blocks any hand edit that nulls `activeSprint` and redirects you to `kyro close-sprint`. Other harnesses rely on this contract directly.

## Routing (handoff.nextAction → mode)

| nextAction | Load |
|------------|------|
| `init` (no sprint.json) | `modes/INIT.md` + one `helpers/analysis/{workType}.md` |
| `clarify` | `modes/clarify.md` |
| `plan_sprint` | `modes/SPRINT.md`, `modes/plan-sprint.md`, then `helpers/sprint-generator.md` |
| `execute_task` | `modes/SPRINT.md`, `modes/execute-task.md` |
| `review_task` | `modes/SPRINT.md`, `modes/review-task.md`, `helpers/reviewer.md` |
| `close_sprint` | `modes/SPRINT.md`, `modes/close-sprint.md`, `helpers/debt-tracker.md` + `helpers/learner.md` as needed |
| `wrap_up` | `modes/close-sprint.md` only if a milestone closed |
| status report | `modes/STATUS.md` |
| inconsistent | `modes/recover.md` |

Templates are loaded only immediately before writing their artifact.

## Artifact Contract

| File | Role |
|------|------|
| `.agents/kyro/kyro.json` | Global registry: `scopes[]` (objects `{id,title,status}`), `activeScope` |
| `.agents/kyro/scopes/{scope}/sprint.json` | Single source of truth (see template) |
| `.agents/kyro/scopes/{scope}/archive/sprint-NNN-slug.md` | Human narrative at close (write-only) |
| `.agents/kyro/scopes/{scope}/archive/sprint-NNN-slug.json` | Verbatim snapshot of the closed sprint (write-only) |
| `.agents/kyro/scopes/{scope}/findings/NN-slug.md` | INIT analysis evidence (write-only) |

There are no `state.json`, `index.json`, `events.ndjson`, `ROADMAP.summary.json`, `DEBT.summary.json`, `rules.index.json`, `rules.md`, `RE-ENTRY-PROMPTS.md`, `phases/`, or `*.summary.json` files. Those are v3 artifacts; run `kyro migrate` to upgrade a v3 scope.

## Boundaries

- INIT is read-only against source code until writing Kyro artifacts.
- Execution may modify project code/docs but must validate touched areas before marking a task done.
- STATUS is read-only unless explicitly mutating debt status.
- Recover preserves user-authored archives and rebuilds `sprint.json` from the best available evidence.
