# Commands Reference

Kyro provides 5 slash commands. Four are thin routers over the single source of truth: each reads structured state first, then loads only the mode/helper/template required for the current action. The fifth, `/kyro:idea`, is an optional **pre-scope** step that runs before any scope or `sprint.json` exists — it never reads or creates project state, and going straight to `/kyro:forge` without it is equally valid.

## Cost-Aware Routing

Kyro command paths are audited by `kyro doctor --tokens`. Brief status never opens sprint Markdown when summaries exist; forge execution never loads planning, debt, or re-entry helpers by default; closeout is the normal materialization point for full documentation.

For scope resume outside slash commands, use `kyro context-pack --kyro-scope <scope>` to emit the same summary-first routing bundle that agents would otherwise assemble manually.

---

## /kyro:idea

**Mature a rough idea into a structured brief before starting a scope. Optional and pre-scope.**

### Syntax

```
/kyro:idea <rough idea>
```

### Arguments

A one-line idea to flesh out (e.g. `quiero hacer un juego de mario kart`). If omitted, the command asks for it.

### What it does

Runs a bounded, one-question-at-a-time conversation to turn a vague idea into a well-formed brief, then writes exactly one markdown document:

```
.agents/kyro/{docType}/{date}-{slug}.md
```

`docType` is inferred from the conversation and confirmed with you before writing — one of `plan` (default, something to build), `analysis` (exploratory/comparative), or `constitution` (durable project ground rules, kept distinct from `kyro.json.principles[]`). The loop stops on an explicit done-signal, a soft limit of 6 questions, or a hard limit of 10 turns.

### Routing

`/kyro:idea` does **not** go through the orchestrator and does **not** route on `sprint.json.handoff.nextAction`. It loads `skills/sprint-forge/assets/modes/idea.md` directly. It never reads, resolves, or creates a scope, `.agents/kyro/kyro.json`, or any `sprint.json` — the matured-idea document is write-only evidence, sibling to `.agents/kyro/scopes/`, and no CLI validator (`doctor`, `analyze`) touches it.

### After maturing

The mode suggests running `/kyro:forge <slug>` (or `/kyro:forge` referencing the document) so INIT can seed the scope's `objective`, `successCriteria[]`, and `spec.requirements[]` from the brief instead of a one-liner.

---

## /kyro:forge

**Full sprint cycle: Analyze, Plan, Implement, Review, Close.**

### Syntax

```
/kyro:forge <project path or description>
```

### Arguments

The argument describes what to analyze or work on. It can be a path, a module name, or a description of the work.

### Examples

```
/kyro:forge analyze the authentication module
/kyro:forge audit code quality in src/api/
/kyro:forge refactor the persistence layer
/kyro:forge add user profile feature
/kyro:forge fix the login timeout bug
```

### Routing

`/kyro:forge` starts with `.agents/kyro/kyro.json`, then the scope's `sprint.json` when a scope exists. It routes on `sprint.json.handoff.nextAction` to exactly one mode:

```text
no roadmap       -> INIT.md
no active sprint -> plan-sprint.md
pending tasks    -> execute-task.md
validation       -> review-task.md
closeout         -> close-sprint.md
inconsistent     -> recover.md
```

Gates still apply at orchestrator-defined checkpoints, but the command file does not duplicate the full lifecycle.

### Gate Options

At each gate, the orchestrator presents a summary and waits for your decision:

| Option | Effect |
|--------|--------|
| `proceed` | Continue to the next phase |
| `adjust` | Modify the output before continuing (describe what to change) |
| `cancel` | Stop the workflow |

### Orchestrator Protocols

- **Command router** -- chooses the next mode from structured state
- **Analysis protocol** -- INIT mode, read-only exploration
- **Review checklist** -- review-task mode and closeout
- **Debug protocol** -- execution failure recovery
- **orchestrator** -- coordinates gates and phase transitions

---

## /kyro:status

**Project progress, sprint state, and technical debt summary.**

### Syntax

```
/kyro:status [brief|full|debt]
```

### Variants

| Variant | What It Shows |
|---------|---------------|
| `brief` | Sprint progress bars and next sprint preview only |
| `full` | Complete report with all sections (default) |
| `debt` | Technical debt table and aged debt items |

### Examples

```
/kyro:status                # Full report
/kyro:status brief          # Quick progress check
/kyro:status debt           # Focus on technical debt
```

### Report Sections

The full report includes:

```
KYRO -- Project Status

## Sprint Progress
Sprint 1: xxxxxxxxxx 10/10 (100%)  Complete
Sprint 2: xxxxxxxx--  8/10 ( 80%)  Complete
Sprint 3: xxxxxxx--- 7/10 ( 70%)  In Progress

## Technical Debt
- Open: 4
- In progress: 1
- Aged: 2
- Critical: 1

## Roadmap Health
- Sprints completed: 2/5
- Roadmap adaptations: 1
- Carry-over tasks: 3

## Next Sprint Preview
Sprint 4: [title]
- Suggested phases: [count]
- Carry-over tasks: [count]
- Critical debt items due: [count]
```

### Data Sources

The status command reads structured state first:
- `.agents/kyro/kyro.json` for project state and the active scope
- `{scope}/sprint.json` for roadmap, active sprint progress, and debt

All metrics come directly from `sprint.json` fields — there are no separate summary files to keep in sync.

---

## /kyro:wrap-up

**Close the current session and refresh `sprint.json.handoff`.**

Reads `.agents/kyro/kyro.json`, resolves the active scope, audits workspace changes, and updates `handoff.nextAction`, `handoff.nextTaskId`, blockers, and the resume note. It asks before commits or user-owned rewrites.

---

## /kyro:task-context

**Generate a copy-paste prompt for continuing Kyro work in a fresh context.**

Reads the active scope, `kyro context-pack`, the current git status, and referenced task/sprint artifacts. It is read-only: it returns one fenced prompt and does not mutate `sprint.json`.
