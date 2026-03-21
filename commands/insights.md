---
description: Database-backed analytics — correction trends, learning heatmap, session stats, velocity patterns
argument-hint: [project name or "all"]
---

# /kyro-workflow:insights — Kyro Analytics

Query the Kyro database to surface patterns in learnings, corrections, sessions, and sprint velocity. All data comes from `.agents/sprint-forge/data.db`.

## Execution

> **IMPORTANT**: Before generating analytics, read the metrics skill:
> 1. Read `skills/kyro-metrics/SKILL.md` — query patterns, heatmap format, velocity calculations

## Scope: $ARGUMENTS

If a project name is provided, filter all queries to that project. If "all" or empty, show analytics across all sprints.

### 1. Correction Trends

Query the `learnings` table to show where corrections cluster:

```sql
-- Top categories by correction count
SELECT category, COUNT(*) as count
FROM learnings
WHERE project = ?  -- if scoped
GROUP BY category
ORDER BY count DESC
LIMIT 10;

-- Trend over time (by sprint)
SELECT sprint, category, COUNT(*) as count
FROM learnings
WHERE sprint IS NOT NULL
GROUP BY sprint, category
ORDER BY sprint;
```

**Display as**: Table of top categories + trend over sprints. Highlight categories that are growing (recurring mistakes) vs shrinking (learned patterns).

### 2. Learning Heatmap

Group learnings by category and project to show knowledge density:

```sql
-- Heatmap: category × project
SELECT project, category, COUNT(*) as rules, SUM(times_applied) as total_applied
FROM learnings
GROUP BY project, category
ORDER BY rules DESC;
```

**Display as**: Matrix with projects as rows, categories as columns, cell value = rule count. Highlight cells where `times_applied` is high (rules that are actively useful).

### 3. Session Stats

Query the `sessions` table for session-level analytics:

```sql
-- Recent sessions with stats
SELECT
  id, project, sprint,
  started_at, ended_at,
  edit_count, corrections_count,
  tasks_completed, tasks_total,
  ROUND((julianday(ended_at) - julianday(started_at)) * 24, 1) as hours
FROM sessions
WHERE project = ?  -- if scoped
ORDER BY started_at DESC
LIMIT 20;
```

**Display as**: Table with per-session stats. Calculate averages:
- Average session duration
- Average edits per session
- Average task completion rate (`tasks_completed / tasks_total`)

### 4. Velocity Accuracy

Compare planned vs actual across sprints to surface estimation patterns:

```sql
-- Velocity: planned vs completed per sprint
SELECT
  sprint,
  SUM(tasks_completed) as completed,
  SUM(tasks_total) as planned,
  ROUND(CAST(SUM(tasks_completed) AS FLOAT) / NULLIF(SUM(tasks_total), 0) * 100, 1) as completion_pct
FROM sessions
WHERE sprint IS NOT NULL
GROUP BY sprint
ORDER BY sprint;
```

**Display as**: Table per sprint showing completion percentage. Highlight:
- Sprints with < 80% completion (over-scoped)
- Sprints with 100% completion (well-estimated or under-scoped)

### 5. Estimation Patterns

Identify systematic estimation biases:

1. Calculate average completion rate across all sprints
2. If consistently < 80%: "You tend to over-scope sprints. Consider reducing task count by ~20%."
3. If consistently 100%: "You may be under-scoping. Consider adding stretch goals."
4. If variable: "Estimation accuracy varies. Check which sprint types are harder to estimate."

Cross-reference with correction trends:
- Sprints with many corrections tend to take longer
- Categories with frequent corrections may need larger time buffers

### Output Format

```
Kyro Insights — {project}
═══════════════════════════════════════════════════

📊 Correction Trends
{table}

🗺️ Learning Heatmap
{matrix}

⏱️ Session Stats
{table + averages}

🎯 Velocity Accuracy
{table + trend}

💡 Estimation Patterns
{analysis + recommendations}

Data source: .agents/sprint-forge/data.db
Total learnings: {count} | Total sessions: {count}
```
