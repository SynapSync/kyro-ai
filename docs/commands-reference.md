# Commands Reference

Sprint Forge provides 5 slash commands. Each command maps to one or more agents and skills that handle the actual work.

---

## /forge

**Full sprint cycle: Analyze, Plan, Implement, Review, Close.**

### Syntax

```
/forge <project path or description>
```

### Arguments

The argument describes what to analyze or work on. It can be a path, a module name, or a description of the work.

### Examples

```
/forge analyze the authentication module
/forge audit code quality in src/api/
/forge refactor the database layer
/forge add user profile feature
/forge fix the login timeout bug
```

### Phases and Gates

The `/forge` command runs the complete lifecycle:

```
[GATE 0: RULES]     Load learned rules from ~/.sprint-forge/rules.md
        |
[PHASE 1: ANALYZE]  Explorer agent investigates codebase (read-only)
        |
   GATE 1            User approves analysis and plan direction
        |
[PHASE 2: PLAN]     Generate sprint with phases, tasks, and estimates
        |
   GATE 2            User approves sprint plan
        |
[PHASE 3: IMPLEMENT] Execute task by task
   |-- After each task: Reviewer validates (BLOCKER/WARNING/SUGGESTION)
   |-- On failure:      Debugger investigates root cause
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

### Agents Involved

- **explorer** -- Phase 1 (analysis)
- **reviewer** -- Phase 3 (after each task)
- **debugger** -- Phase 3 (on task failure)
- **orchestrator** -- coordinates the full cycle

---

## /sprint

**Generate and/or execute the next sprint.**

### Syntax

```
/sprint [generate|execute|generate and execute]
```

### Arguments

| Argument | Effect |
|----------|--------|
| `generate` | Creates the sprint document only, without executing |
| `execute` | Executes an already-generated sprint file |
| `generate and execute` | Creates the sprint and immediately executes it |
| *(no argument)* | Same as `generate and execute` |

### Examples

```
/sprint generate              # Create Sprint N without executing
/sprint execute               # Execute the current sprint
/sprint generate and execute  # Create and run Sprint N
/sprint                       # Same as "generate and execute"
```

### Generate Workflow

1. Locate the output directory (`{output_sprint_forge_dir}`)
2. Determine the sprint number (highest existing + 1)
3. Gather inputs: roadmap section, previous sprint retro, finding files
4. Build the disposition table (Sprint 2+): every recommendation from Sprint N-1 must be addressed
5. Build phases from roadmap suggestions, recommendations, and debt items
6. Write the sprint file to `sprints/SPRINT-N-slug.md`

### Execute Workflow

1. Read the sprint file and set execution metadata
2. Execute tasks one by one:
   - Mark task as in-progress `[~]`
   - Do the work (read, write, test)
   - Run reviewer checklist
   - Mark as done `[x]`, blocked `[!]`, or carry-over `[>]`
3. Checkpoint after each phase completes
4. Handle emergent work (add new phases as needed)
5. Close sprint: consolidate findings, fill retro, update debt, update frontmatter
6. Update re-entry prompts
7. Update roadmap if execution revealed changes

### Task Status Markers

| Marker | Meaning |
|--------|---------|
| `[ ]` | Not started |
| `[~]` | In progress |
| `[x]` | Completed |
| `[!]` | Blocked (with explanation) |
| `[>]` | Carry-over to next sprint |
| `[-]` | Skipped |

---

## /status

**Project metrics, velocity trends, and technical debt heatmap.**

### Syntax

```
/status [brief|full|debt|velocity]
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
/status                # Full report
/status brief          # Quick progress check
/status debt           # Focus on technical debt
/status velocity       # Focus on sprint velocity trends
```

### Report Sections

The full report includes:

```
SPRINT FORGE -- Project Status

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

---

## /debt

**Manage and review technical debt.**

### Syntax

```
/debt [list|add|resolve|escalate]
```

### Subcommands

#### /debt list

Display the full accumulated technical debt table from the latest sprint:

```
/debt list
```

Output:

```
## Accumulated Technical Debt

| # | Item                             | Origin         | Sprint Target | Status      | Resolved In |
|---|----------------------------------|----------------|---------------|-------------|-------------|
| 1 | Missing auth middleware tests     | INIT finding   | Sprint 2      | resolved    | Sprint 2    |
| 2 | Hardcoded API timeout values      | Sprint 1 retro | Sprint 3      | in-progress | --          |
| 3 | N+1 query in /api/users           | Sprint 2 phase | Sprint 3      | open        | --          |
| 4 | Deprecated crypto.createCipher    | INIT finding   | Sprint 4      | open        | --          |
```

#### /debt add

Add a new debt item:

```
/debt add "Missing error boundary in dashboard" --origin "Sprint 3 retro" --target "Sprint 4"
```

Parameters:
- First argument: description of the debt item (quoted string)
- `--origin`: where the debt was discovered (e.g., "INIT finding", "Sprint 2 phase", "Sprint 3 retro")
- `--target`: which sprint should address it

#### /debt resolve

Mark a debt item as resolved:

```
/debt resolve 3 --sprint "Sprint 3"
```

Parameters:
- First argument: debt item number
- `--sprint`: which sprint resolved it

#### /debt escalate

Flag aged debt items that have been open for more than 3 sprints:

```
/debt escalate
```

For each aged item, you are asked:
- Should this become a dedicated sprint?
- Should the priority be increased?
- Is this still relevant or can it be closed as N/A?

### Debt Rules

- Debt items are never deleted -- only their status changes
- Every sprint inherits the full debt table from the previous sprint
- Items open for more than 3 sprints (configurable via `config.json` `sprint.debt_aged_threshold_sprints`) trigger the escalation prompt
- New debt discovered during execution is added with origin "Sprint N phase"
- Valid statuses: `open`, `in-progress`, `resolved`, `deferred`
- Valid severities: `critical`, `high`, `medium`, `low`

---

## /retro

**Sprint retrospective ritual.**

### Syntax

```
/retro [sprint number]
```

### Arguments

| Argument | Effect |
|----------|--------|
| *(no argument)* | Run retro for the most recent sprint |
| `3` | Run retro for Sprint 3 specifically |

### Ritual Steps

The retrospective follows a structured 8-step ritual:

#### Step 1: Gather Data

Automatically collects:
- Tasks completed vs. planned
- Tasks blocked or skipped (with reasons)
- Emergent phases added during execution
- Quality gate results per task

#### Step 2: What Went Well

Identifies patterns that worked:
- Effective approaches
- Good estimation accuracy
- Smooth task execution
- Helpful learned rules that prevented mistakes

#### Step 3: What Didn't Go Well

Identifies pain points:
- Underestimated tasks
- Blocked work
- Repeated corrections from the user
- Quality gate failures

#### Step 4: Surprises

Documents unexpected discoveries:
- Hidden dependencies
- Undocumented behaviors
- Performance characteristics
- Security concerns

#### Step 5: New Technical Debt Detected

Lists items discovered during execution:
- Workarounds introduced
- Incomplete implementations
- TODOs left in code

#### Step 6: Recommendations for Sprint N+1

Numbered recommendations that MUST be addressed in the next sprint's disposition table:
- Tasks to carry over
- Approaches to adjust
- New areas to investigate
- Estimation adjustments

#### Step 7: Rule Proposals

Based on corrections and learnings during the sprint:

```
Proposed rules for ~/.sprint-forge/rules.md:

[RULE-XXX] Category: One-line rule
  Context: Why this rule exists (from this sprint's experience)
  Confirm? (yes/no)
```

Each proposed rule requires your approval before being saved.

#### Step 8: LEARNED Section

Formal capture of confirmed learnings:

```markdown
## LEARNED (Sprint N)
- [RULE-007] Always validate version compatibility before adding dependencies
- [RULE-008] Auth tasks usually reveal hidden dependencies -- add 20% buffer
```

### Output

The retro is written directly into the sprint file's Retro section. After completion:
1. Re-entry prompts are updated
2. Roadmap is updated if recommendations affect future sprints
3. Confirmed rules are saved to `~/.sprint-forge/rules.md`
