# Kyro Metrics — Velocity & Debt Analytics

## Purpose

Quantitative analysis of sprint history to identify patterns, improve estimation, and visualize debt. All data comes from `sprint.json` — `ledger[]`, `previousSprint`, `activeSprint`, and `debt[]`. No summaries, no `index.json`.

## Metrics

### Velocity Trend

Completion rate per closed sprint, from `ledger[]` outcomes + the closed-sprint snapshots:

```text
Sprint 1: ████████░░  8/10 tasks (80%)
Sprint 2: ██████████ 10/10 tasks (100%)
Average velocity: 90%
```

### Debt Heatmap

Group `debt[]` items by the directory implied in `title`/`note`:

```text
src/auth/  ████████ 4 items (2 critical)
src/db/    █████░░░ 3 items (1 critical)
```

### Underestimation Patterns

Compare planned vs actual (including `emergentTasks`) across the closed sprints to spot task types that overrun.

### Sprint Health Score

Composite of velocity (30%), debt trend (25%), carry-over count (20%), estimation accuracy (25%).

## Data Sources (all in sprint.json)

- `ledger[]` + closed-sprint snapshots (`archive/sprint-NNN-slug.json`) for task counts and outcomes.
- `debt[]` for accumulated debt state and age (`origin` vs current sprint).
- `roadmap` for planned vs actual sprint sequencing.
- `conventions[]` tagged `estimation` for adjustment rules.

## Calculation

Read `sprint.json` once. For historical task counts, read the per-sprint archive snapshots (write-only JSON) only when computing trends across closed sprints. Then compute task counts, debt-to-directory mapping, item age, and planned-vs-actual phases.
