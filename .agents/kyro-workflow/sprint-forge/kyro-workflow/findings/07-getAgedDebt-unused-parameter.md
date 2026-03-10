---
title: "Finding: getAgedDebt() parameter is accepted but ignored"
date: "2026-03-10"
project: "kyro-workflow"
type: "analysis"
status: "active"
severity: "high"
category: "bug"
agents:
  - "claude-opus-4-6"
tags:
  - "kyro-workflow"
  - "analysis"
  - "finding"
changelog:
  - version: "1.0"
    date: "2026-03-10"
    changes: ["Finding documented"]
related:
  - "[[ROADMAP]]"
---

# Finding: getAgedDebt() parameter is accepted but ignored

## Summary

`store.ts:getAgedDebt(project, maxSprints)` accepts a `maxSprints` parameter (defaulting to 3) but the SQL query never uses it. The function returns ALL open/in-progress debt items regardless of age. This means the "3 sprint threshold" configured in config.json has no effect.

## Severity / Impact

high -- The debt aging feature is a core workflow promise ("Items open for >3 sprints trigger the DebtItemAged hook"). Even if the hook existed, the query backing it cannot filter by age because the schema lacks a `created_sprint` or equivalent field to calculate age.

## Details

```typescript
getAgedDebt(project: string, maxSprints = 3): DebtItem[] {
  // maxSprints is never used in the query
  return db.prepare(`
    SELECT * FROM debt_items
    WHERE project = ? AND status IN ('open', 'in-progress')
    ORDER BY created_at ASC
  `).all(project) as DebtItem[];
}
```

The `debt_items` schema has `sprint_target` but no `sprint_created` or `sprint_number` field. There is no way to calculate how many sprints a debt item has been open without cross-referencing the session/sprint data.

## Affected Files

- `src/db/store.ts:139-146`
- `src/db/schema.sql` (debt_items table -- missing sprint_created)

## Recommendations

1. Add a `sprint_created` column to the debt_items schema
2. Use it in the `getAgedDebt()` query to filter items open for > maxSprints
3. Or calculate age from `created_at` relative to sprint start dates in the sessions table
