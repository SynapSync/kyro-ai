# Commands Reference

Kyro provides 3 slash commands. Each command maps to one or more agents and skills that handle the actual work.

---

## /kyro-workflow:forge

**Full sprint cycle: Analyze, Plan, Implement, Review, Close.**

### Syntax

```
/kyro-workflow:forge <project path or description>
```

### Arguments

The argument describes what to analyze or work on. It can be a path, a module name, or a description of the work.

### Examples

```
/kyro-workflow:forge analyze the authentication module
/kyro-workflow:forge audit code quality in src/api/
/kyro-workflow:forge refactor the database layer
/kyro-workflow:forge add user profile feature
/kyro-workflow:forge fix the login timeout bug
```

### Phases and Gates

The `/kyro-workflow:forge` command runs the complete lifecycle:

```
[GATE 0: RULES]     Load learned rules from .agents/sprint-forge/rules.md
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

## /kyro-workflow:status

**Project metrics, velocity trends, and technical debt heatmap.**

### Syntax

```
/kyro-workflow:status [brief|full|debt|velocity]
```

### Variants

| Variant | What It Shows |
|---------|---------------|
| `brief` | Sprint progress bars and next sprint preview only |
| `full` | Complete report with all sections (default) |
| `debt` | Technical debt table and debt heatmap by directory |
| `velocity` | Velocity trends, estimation accuracy, underestimation patterns |

### Examples

```
/kyro-workflow:status                # Full report
/kyro-workflow:status brief          # Quick progress check
/kyro-workflow:status debt           # Focus on technical debt
/kyro-workflow:status velocity       # Focus on sprint velocity trends
```

### Report Sections

The full report includes:

```
KYRO -- Project Status

## Sprint Progress
Sprint 1: xxxxxxxxxx 10/10 (100%)  Complete
Sprint 2: xxxxxxxx--  8/10 ( 80%)  Complete
Sprint 3: xxxxxxx--- 7/10 ( 70%)  In Progress

## Velocity Trend
Sprint 1: xxxxxxxx-- 80%
Sprint 2: xxxxxxxxxx 100%
Sprint 3: xxxxxxx--- 70%  <-- underperformance: DB tasks x2

## Debt Heatmap
src/auth/    xxxxxxxx 4 items (2 critical, aged: 3 sprints)
src/db/      xxxxx--- 3 items (1 critical)
src/api/     xx------ 1 item

## Underestimation Patterns
- DB/migration tasks: underestimated by ~40%
- Auth tasks: frequently reveal hidden dependencies

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
- All `sprints/SPRINT-*.md` files for progress, debt, and retro data

