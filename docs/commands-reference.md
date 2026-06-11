# Commands Reference

Kyro defines 3 workflow intents. On Claude Code they map to slash commands; on other harnesses use the **manual intent** equivalents below.

| Intent | Slash command (Claude Code) | Manual equivalent |
|--------|----------------------------|-------------------|
| `forge` | `/kyro-workflow:forge` | Analyze, plan, implement, review, and close the sprint |
| `status` | `/kyro-workflow:status` | Read artifacts and report progress/debt |
| `wrap-up` | `/kyro-workflow:wrap-up` | Close session and update re-entry prompts |

---

## forge

**Full sprint cycle: Analyze, Plan, Implement, Review, Close.**

### Manual intent

```text
Use Kyro forge mode. Read .agents/orchestrator.md and the sprint-forge skill.
Target: {scope or description}. Persist artifacts under .agents/sprint-forge/{scope}/.
Stop at each approval gate.
```

### Slash syntax (Claude Code)

```
/kyro-workflow:forge <project path or description>
```

### Arguments

The argument describes what to analyze or work on. It can be a path, a module name, or a description of the work.

### Examples

```
/kyro-workflow:forge analyze the authentication module
/kyro-workflow:forge audit code quality in src/api/
/kyro-workflow:forge refactor the persistence layer
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

## status

**Project progress, sprint state, and technical debt summary.**

### Manual intent

```text
Run Kyro status intent for .agents/sprint-forge/{scope}/.
Report sprint progress, open debt, aged items, and next action.
Optional variant: brief | full | debt
```

### Slash syntax (Claude Code)

```
/kyro-workflow:status [brief|full|debt]
```

### Variants

| Variant | What It Shows |
|---------|---------------|
| `brief` | Sprint progress bars and next sprint preview only |
| `full` | Complete report with all sections (default) |
| `debt` | Technical debt table and aged debt items |

### Examples

```
/kyro-workflow:status                # Full report
/kyro-workflow:status brief          # Quick progress check
/kyro-workflow:status debt           # Focus on technical debt
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
- All `sprints/SPRINT-*.md` files for progress, debt, and retro data
