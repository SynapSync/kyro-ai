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

One scope = one `sprint.json`. Agents read `kyro.json` (registry) + the scope's `sprint.json`, then route on `handoff.nextAction`. No other agent-facing files.

## Core Invariants

1. `sprint.json` is the single source of truth. Two reads to start (`kyro.json` + `sprint.json`), one file to update per action.
2. Route on `sprint.json.handoff.nextAction` — never infer state from file presence.
3. Generate one sprint at a time; never pre-generate future sprints.
4. Tasks are self-contained: every task carries `description`, `files_to_touch`, `context`, `acceptance_criteria`.
5. Debt never disappears; it only changes `status` (`open → in_progress → resolved | deferred`).
6. Closing a sprint (snapshot-then-clear of `activeSprint`) is owned by `kyro close-sprint` — never null `activeSprint` by hand. The closed sprint becomes one `ledger[]` entry.
7. Findings and archives are write-only evidence; agents never re-read them to route.
8. **Admit unknowns, never guess.** Write `[NEEDS CLARIFICATION: <gap>]` instead of inventing, and route to `clarify`. `kyro doctor`/`analyze` FAIL while any marker remains — a deterministic gate, not a suggestion.

## Artifact Write Contract (MANDATORY)

Every mutation of `sprint.json` or `kyro.json` MUST be a **safe write**:

> Read the whole file → `JSON.parse` → mutate the object → serialize → overwrite in one write → re-parse to confirm. If the re-parse fails, restore and report.

NEVER partial/string-replace for structural changes (nulling `activeSprint`, removing a nested block) — it orphans the JSON body and corrupts the source of truth. Only exception: the per-sprint archive snapshot (a fresh file, pure write, never re-read).

## Tool-owned operations (use the CLI, do not hand-roll)

Irreversible or schema-critical operations are done deterministically by the CLI — never by hand:

| Command | What it owns |
|---------|--------------|
| `kyro close-sprint --kyro-scope <scope> --outcome <...>` | Zero-loss close: snapshots `activeSprint` to `archive/` **before** clearing it, renders the narrative `.md` (title from `roadmap.sprints[]`), appends the `ledger[]` entry, updates `previousSprint`/`roadmap`/`handoff`, flips `kyro.json` status. Refuses on double-close. |
| `kyro doctor --artifacts --kyro-scope <scope>` | Validates shape drift, missing snapshots, and unresolved `[NEEDS CLARIFICATION]`. |
| `kyro analyze --kyro-scope <scope>` | Semantic cross-check (clarity, coverage, deps, debt, principles), severity-triaged; non-zero on CRITICAL/HIGH. Gate before close. |
| `kyro repair --kyro-scope <scope>` | Normalizes `sprint.json` formatting. |

In Claude Code a `PreToolUse` hook blocks any hand edit that nulls `activeSprint`; other harnesses rely on this contract directly.

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

## Principles vs conventions

- **`conventions[]`** (`sprint.json`): *learned*, descriptive rules from retros; inform task `context`.
- **`principles[]`** (`kyro.json`, project-level): *authored*, immutable gates (spec-kit's constitution). Each `{ id, rule, severity, rationale, check? }`. A violated `non-negotiable` is a hard stop. Those with a built-in `check` are enforced by `kyro analyze`; free-text ones are agent gates at `plan-sprint`/`review-task`.

## Artifact Contract

| File | Role |
|------|------|
| `.agents/kyro/kyro.json` | Global registry: `scopes[]` (objects `{id,title,status}`), `activeScope`, optional `principles[]` |
| `.agents/kyro/scopes/{scope}/sprint.json` | Single source of truth (see template) |
| `.agents/kyro/scopes/{scope}/archive/sprint-NNN-slug.md` | Human narrative at close (write-only) |
| `.agents/kyro/scopes/{scope}/archive/sprint-NNN-slug.json` | Verbatim snapshot of the closed sprint (write-only) |
| `.agents/kyro/scopes/{scope}/findings/NN-slug.md` | INIT analysis evidence (write-only) |

The only per-scope files are `sprint.json` and the write-only `archive/` + `findings/`. Nothing else is created or read.

## Boundaries

- INIT is read-only against source code until it writes Kyro artifacts.
- Execution may modify code/docs but must validate touched areas before marking a task done.
- STATUS is read-only unless explicitly mutating debt status.
- Recover preserves user archives and rebuilds `sprint.json` from the best evidence.
