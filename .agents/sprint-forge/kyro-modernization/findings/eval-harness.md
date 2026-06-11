---
title: "Finding — Eval Harness"
date: "2026-06-11"
scope: "kyro-modernization"
type: "finding"
status: "open"
severity: "high"
target_sprint: 5
---

# Finding — Eval Harness

## Summary

Kyro has no regression suite for the workflow itself.

## Impact

Changes to prompts, scripts, state, and gates can silently degrade behavior. This is especially risky before adding subagent parallelism.

## Recommendation

Create fixture repos and scenario tests that assert structural invariants such as INIT artifact creation, full debt inheritance, blocker gating, and recommendation disposition.
