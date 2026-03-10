---
name: review
description: Assessment context for sprint status reporting, retrospectives, and metrics analysis. Read-only — no code changes.
mode: assessment
agent: reviewer
model: sonnet
---

# Context: REVIEW — Assessment Mode

Activated during status checks and retrospectives. This context puts Kyro in **analysis-only mode** focused on measuring, reflecting, and planning improvements.

## When Active

- `/kyro-workflow:status` — project metrics and debt heatmap
- `/kyro-workflow:retro` — sprint retrospective ritual
- `/kyro-workflow:forge` Phase 4 (Review & Close)
- `/kyro-workflow:debt` — technical debt review

## Behavior

### Status Assessment (`/kyro-workflow:status`)

1. Read the current sprint file and extract task statuses.
2. Calculate progress metrics:
   - Tasks completed / total tasks
   - Story points completed / total story points
   - Estimation accuracy (actual vs estimated per task)
3. Generate velocity trend from historical sprints.
4. Produce a debt heatmap showing:
   - Open debt items by file/module
   - Age of each item (sprints since creation)
   - Items flagged as `[AGED]` (open > 3 sprints)

### Retrospective (`/kyro-workflow:retro`)

1. Read the completed sprint file.
2. Evaluate each task:
   - Was it completed within estimate?
   - Were there blockers or emergent work?
   - What quality issues were found?
3. Generate the retro document:
   - **What went well** — tasks completed smoothly, good estimates
   - **What went wrong** — blockers, underestimates, regressions
   - **Recommendations** — numbered list of improvements for Sprint N+1
   - **Estimation corrections** — adjusted buffers for task types
   - **New learned rules** — proposed additions to `.agents/kyro/rules.md`
4. Update the debt table with any new items or status changes.

### Metrics Analysis

The `kyro-metrics` skill provides:

- Velocity trend (SP/sprint over last 5 sprints)
- Estimation accuracy trend (mean absolute error over time)
- Debt accumulation rate (new items per sprint vs resolved)
- Most common BLOCKER categories
- Task type distribution

### Feed Forward

Review outputs feed directly into next sprint planning:

- Recommendations become the disposition table in Sprint N+1.
- Estimation corrections update buffer percentages.
- New rules are proposed for `.agents/kyro/rules.md`.
- Unresolved debt items carry forward with updated age.

## Constraints

- **No code changes.** This context is analysis only.
- **No file creation** except sprint retro documents and metrics reports in the output directory.
- **No git operations** that modify history.

## Delegation

- **Primary agent**: reviewer (quality assessment and metrics)
- Tools: `Read`, `Glob`, `Grep`, `Bash` (read-only commands only)
- Skills: `kyro-metrics`, `kyro-reviewer`

## Output

- Status report with progress metrics and debt heatmap
- Retro document with recommendations and estimation corrections
- Velocity and accuracy trend data
- Proposed learned rules

## Rules in Effect

- All rules from `rules/sprint-discipline.md` (retro is mandatory, debt inheritance)
- All rules from `rules/estimation.md` (flag >30% errors, track trends)
- All rules from `rules/learning-rules.md` (propose and validate new rules)
- All rules from `rules/context-persistence.md` (update re-entry prompts after retro)
