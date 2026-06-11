---
title: "Finding — Context Economy"
date: "2026-06-11"
scope: "kyro-modernization"
type: "finding"
status: "open"
severity: "medium"
target_sprint: 3
---

# Finding — Context Economy

## Summary

`skills/qa-review/SKILL.md` is a 660-line monolith, and lifecycle guidance is duplicated between `commands/forge.md` and `agents/orchestrator.md`.

## Impact

Large default-loaded instructions waste context and increase the chance that agents miss the important route-specific guidance.

## Recommendation

Split `qa-review` into a small routing core and on-demand references. Make `orchestrator.md` the lifecycle source of truth and keep command files thin.
