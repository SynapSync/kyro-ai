---
title: "Finding: DebtItemAged hook referenced but never defined"
date: "2026-03-10"
project: "kyro-workflow"
type: "analysis"
status: "active"
severity: "high"
category: "sync-issue"
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

# Finding: DebtItemAged hook referenced but never defined

## Summary

The `/kyro-workflow:debt` command (debt.md line 65) states: "Items open for >3 sprints trigger the `DebtItemAged` hook automatically." However, no such hook exists in `hooks/hooks.json`. The hook is a phantom -- documented as a feature but never implemented.

## Severity / Impact

high -- Users expect aged debt items to trigger automatic escalation. Instead, debt silently ages without any notification. The `config.json` even defines `debt_aged_threshold_sprints: 3`, reinforcing the expectation that this is an active feature.

## Details

- `commands/debt.md:65` references `DebtItemAged` hook
- `config.json:32` defines `debt_aged_threshold_sprints: 3`
- `hooks/hooks.json` does NOT contain a `DebtItemAged` event
- `store.ts:getAgedDebt()` exists but is never called by any hook script
- The `maxSprints` parameter in `getAgedDebt()` is accepted but unused in the query

## Affected Files

- `commands/debt.md:65`
- `hooks/hooks.json` (missing entry)
- `config.json:32`
- `src/db/store.ts:139-146`

## Recommendations

1. Implement a `DebtItemAged` check in the `SessionStart` hook or `TaskCompleted` hook
2. Use `store.getAgedDebt()` with proper sprint-age calculation
3. Fix `getAgedDebt()` to actually filter by sprint count (currently returns all open items)
