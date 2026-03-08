---
description: Show project status, velocity metrics, and technical debt heatmap
argument-hint: [brief|full|debt|velocity]
---

# /status — Project Status & Metrics

Report project progress, sprint velocity, technical debt heatmap, and next sprint preview.

## View: $ARGUMENTS

### Standard Report

1. **Locate output directory** — resolve `{output_sprint_forge_dir}`
2. **Read project state** — README, ROADMAP, all sprint files
3. **Calculate metrics** and generate report:

```text
══════════════════════════════════════
SPRINT FORGE — Project Status
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
