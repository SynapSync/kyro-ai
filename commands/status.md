---
description: Show project status, velocity metrics, and technical debt heatmap
argument-hint: [brief|full|debt|velocity|debt-add|debt-resolve|debt-escalate]
---

# /kyro-workflow:status — Project Status & Metrics

Report project progress, sprint velocity, technical debt heatmap, and next sprint preview.

## Execution

> **IMPORTANT**: Before generating the report, read the sprint-forge skill's STATUS mode:
> 1. Read `skills/sprint-forge/SKILL.md` — capabilities matrix, configuration resolution
> 2. Read `skills/sprint-forge/assets/modes/STATUS.md` — report workflow and format
> 3. Read `skills/sprint-forge/assets/helpers/debt-tracker.md` — debt heatmap format

## View: $ARGUMENTS

### Standard Report

1. **Locate output directory** — resolve `{output_kyro_dir}`
2. **Read project state** — README, ROADMAP, all sprint files
3. **Calculate metrics** and generate report:

```text
══════════════════════════════════════
KYRO — Project Status
══════════════════════════════════════

## Sprint Progress
Sprint 1: ██████████ 10/10 (100%) ✓ Complete
Sprint 2: ████████░░  8/10 ( 80%) ✓ Complete
Sprint 3: ███████░░░  7/10 ( 70%) ~ In Progress
Sprint 4: ░░░░░░░░░░  0/10 (  0%)   Planned

## Velocity Trend
Sprint 1: ████████░░  80%
Sprint 2: ██████████ 100%
Sprint 3: ███████░░░  70% ← underperformance: DB tasks x2

## Debt Heatmap
src/auth/    ████████ 4 items (2 critical, aged: 3 sprints)
src/db/      █████░░░ 3 items (1 critical)
src/api/     ██░░░░░░ 1 item

## Underestimation Patterns
- DB/migration tasks: underestimated by ~40%
- Auth tasks: frequently reveal hidden dependencies

## Roadmap Health
- Sprints completed: 2/5
- Roadmap adaptations: 1 (Sprint 3 scope reduced)
- Carry-over tasks: 3

## Next Sprint Preview
Sprint 4: [title from roadmap]
- Suggested phases: [count]
- Carry-over tasks: [count]
- Critical debt items due: [count]
```

### Variants

- **brief** — Sprint progress + next sprint preview only
- **full** — Complete report with all sections
- **debt** — Focus on technical debt table and heatmap
- **velocity** — Focus on velocity trends and estimation patterns

## Debt Management

The `debt-*` variants provide direct debt lifecycle actions. Read `skills/sprint-forge/assets/helpers/debt-tracker.md` before executing any of these.

### debt-add

Add a new debt item:

```
/kyro-workflow:status debt-add "Missing error boundary in dashboard" --origin "Sprint 3 retro" --target "Sprint 4"
```

### debt-resolve

Mark a debt item as resolved:

```
/kyro-workflow:status debt-resolve 3 --sprint "Sprint 3"
```

### debt-escalate

Flag aged debt items (open >3 sprints) and prompt for triage:
- Should this become a dedicated sprint?
- Should the priority be increased?
- Is this still relevant or can it be closed as N/A?

### Debt Rules

- Debt items are never deleted — only their status changes
- Every sprint inherits the full debt table from the previous sprint
- Items open for >3 sprints trigger a guardian escalation prompt automatically
- New debt discovered during execution gets added with origin "Sprint N phase"
