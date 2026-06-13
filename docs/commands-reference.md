# Commands Reference

Kyro provides 3 slash commands. Each command maps to one or more agents and skills that handle the actual work.

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

### Phases and Gates

The `/kyro:forge` command runs the complete lifecycle:

```
[GATE 0: RULES]     Load learned rules from .agents/kyro/scopes/rules.md
        |
[PHASE 1: ANALYZE]  Analysis phase investigates codebase (read-only)
        |
   GATE 1            User approves analysis and plan direction
        |
[PHASE 2: PLAN]     Generate sprint with phases, tasks, and estimates
        |
   GATE 2            User approves sprint plan
        |
[PHASE 3: IMPLEMENT] Execute task by task
   |-- After each task: Review step validates (BLOCKER/WARNING/SUGGESTION)
   |-- On failure:      Debug protocol investigates root cause
   |-- After each phase: Checkpoint saved to disk
        |
   GATE 3            User approves implementation
        |
[PHASE 4: REVIEW]   Full sprint review + retrospective
        |
[PHASE 5: CLOSE]    Debt update, re-entry prompts, rule proposals
```

### Gate Options

At each gate, the orchestrator presents a summary and waits for your decision:

| Option | Effect |
|--------|--------|
| `proceed` | Continue to the next phase |
| `adjust` | Modify the output before continuing (describe what to change) |
| `cancel` | Stop the workflow |

### Orchestrator Protocols

- **Analysis protocol** -- Phase 1 (codebase exploration, read-only)
- **Review checklist** -- Phase 3 (after each task)
- **Debug protocol** -- Phase 3 (on task failure)
- **orchestrator** -- coordinates the full cycle

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

The status command reads all files in the output directory:
- `README.md` for project overview
- `ROADMAP.md` for planned sprints
- All `phases/SPRINT-*.md` files for progress, debt, and retro data
