---
title: "Finding — Structured State"
date: "2026-06-11"
scope: "kyro-modernization"
type: "finding"
status: "open"
severity: "high"
target_sprint: 2
---

# Finding — Structured State

## Summary

Kyro's debt, sprint status, recommendations, and metrics are encoded in markdown tables that agents must parse and rewrite correctly.

## Impact

The rule "debt never disappears" is currently an instruction, not an invariant. Manual markdown edits can silently remove debt or break metrics.

## Recommendation

Introduce a portable `state.json` sidecar per scope as the source of truth. Markdown remains the human-readable view, generated from state.
