# Commands Reference

Kyro provides 3 slash commands. Each command is now a thin router: it reads structured state first, then loads only the mode/helper/template required for the current action.

## Cost-Aware Routing

Kyro command paths are audited by `kyro doctor --tokens`. Brief status never opens sprint Markdown when summaries exist; forge execution never loads planning, debt, or re-entry helpers by default; closeout is the normal materialization point for full documentation.

For scope resume outside slash commands, use `kyro context-pack --kyro-scope <scope>` to emit the same summary-first routing bundle that agents would otherwise assemble manually.

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
