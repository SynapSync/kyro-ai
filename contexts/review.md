---
name: review
description: Assessment context for sprint status reporting and retrospectives. Read-only — no code changes.
mode: assessment
agent: orchestrator
model: opus
---

# Context: REVIEW — Assessment Mode

Activated during status checks and retrospectives. This context puts Kyro in **analysis-only mode** focused on measuring, reflecting, and planning improvements.

## When Active

- `/kyro:status` — project progress and debt summary
- `/kyro:forge` Phase 4 (Review & Close)

## Behavior

### Status Assessment (`/kyro:status`)

1. Read the current sprint file and extract task statuses.
2. Summarize progress:
   - Tasks completed / total tasks
   - Story points completed / total story points
   - Estimation accuracy (actual vs estimated per task)
3. Produce a debt summary showing:
   - Open debt items
   - Age of each item (sprints since creation)
   - Items flagged as `[AGED]` (open > 3 sprints)

### Retrospective (forge Phase 4)

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
   - **New learned rules** — proposed additions to `.agents/kyro/scopes/rules.md`
4. Update the debt table with any new items or status changes.

### Progress Analysis

The metrics helper provides:

- Sprint completion status
- Estimate variance noted in sprint retros
- Debt movement (new items vs resolved)
- Most common BLOCKER categories
- Task type distribution

### Feed Forward

Review outputs feed directly into next sprint planning:

- Recommendations become the disposition table in Sprint N+1.
- Estimation corrections update buffer percentages.
- New rules are proposed for `.agents/kyro/scopes/rules.md`.
- Unresolved debt items carry forward with updated age.

## Constraints

- **No code changes.** This context is analysis only.
- **No file creation** except sprint retro documents and metrics reports in the output directory.
- **No git operations** that modify history.

## Delegation

- **Primary agent**: orchestrator (using review checklist protocol)
- Tools: `Read`, `Glob`, `Grep`, `Bash` (read-only commands only)
- Helpers: `metrics`, `reviewer` (in `skills/core/assets/helpers/`)

## Output

- Status report with progress and debt summary
- Retro document with recommendations and estimation corrections
- Proposed learned rules

## Rules in Effect

- All rules from `rules/sprint-discipline.md` (retro is mandatory, debt inheritance)
- All rules from `rules/estimation.md` (flag >30% errors, track trends)
- All rules from `rules/learning-rules.md` (propose and validate new rules)
- All rules from `rules/context-persistence.md` (update re-entry prompts after retro)
