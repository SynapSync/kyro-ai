---
title: "Finding — Quick Wins"
date: "2026-06-11"
scope: "kyro-modernization"
type: "finding"
status: "open"
severity: "medium"
target_sprint: 0
---

# Finding — Quick Wins

## Summary

The repository has five confirmed hygiene issues that should be resolved before deeper modernization begins.

## Evidence

- `skills/sprint-forge/SKILL.md` references a non-existent `../integrations/obsidian/...` path.
- `skills/sprint-forge/SKILL.md` still says `Kyro v2.0` while package metadata is `3.3.0`.
- `src/db/` and `src/search/` are empty.
- Version metadata is manually synchronized across `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `WORKFLOW.yaml`.
- `commands/forge.md` duplicates lifecycle content that should belong to `agents/orchestrator.md`.

## Recommendation

Execute Sprint 0 to restore baseline integrity with minimal behavior change.
