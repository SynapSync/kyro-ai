---
name: kyro-metrics
description: >
  Sprint velocity tracking, technical debt heatmap, and estimation pattern analysis.
  Enriches STATUS mode with historical data and trend visualization.
---

# Kyro Metrics — Velocity & Debt Analytics

## Purpose

Provides quantitative analysis of sprint execution history to identify patterns, improve estimation accuracy, and visualize technical debt distribution.

## Metrics

### Velocity Trend

Track completion rate per sprint:

```text
## Velocity Trend
Sprint 1: ████████░░  8/10 tasks (80%)
Sprint 2: ██████████ 10/10 tasks (100%)
Sprint 3: ███████░░░  7/10 tasks (70%) ← underperformance: DB tasks x2
Sprint 4: █████████░  9/10 tasks (90%)

Average velocity: 85%
Trend: stable (±10%)
```

### Debt Heatmap

Show debt concentration by directory/module:

```text
## Debt Heatmap
src/auth/    ████████ 4 items (2 critical, aged: 3 sprints)
src/db/      █████░░░ 3 items (1 critical)
src/api/     ██░░░░░░ 1 item
src/ui/      ░░░░░░░░ 0 items

Total: 8 items (3 critical, 2 aged >3 sprints)
```

### Underestimation Patterns

Identify task types that are consistently underestimated:

```text
## Underestimation Patterns
- DB/migration tasks: underestimated by ~40% (3 occurrences)
- Auth tasks: reveal hidden dependencies in 67% of cases
- UI tasks: generally accurate (±10%)
- API tasks: underestimated by ~15% when involving auth
```

### Sprint Health Score

Composite score based on:
- Velocity (weight: 30%)
- Debt trend — increasing or decreasing (weight: 25%)
- Carry-over count (weight: 20%)
- Estimation accuracy (weight: 25%)

```text
## Sprint Health
Score: 72/100 (Good)
  Velocity:    ████████░░ 85% (25.5/30)
  Debt trend:  ██████░░░░ ↗ increasing (15/25)
  Carry-over:  ████████░░ 2 tasks (16/20)
  Estimation:  ██████░░░░ ±25% avg error (15.5/25)
```

## Data Sources

- Sprint files: task counts, completion status, retro data
- Debt tables: accumulated across all sprints
- Roadmap: planned vs actual sprint scope
- Rules file: estimation adjustment rules

## Calculation

Read all sprint files in `{output_kyro_dir}/sprints/` and compute:

1. Count tasks per sprint (total, completed, blocked, skipped, carry-over)
2. Map debt items to source directories
3. Track item age (sprint introduced vs current sprint)
4. Compare planned phases vs actual phases (including emergent)
