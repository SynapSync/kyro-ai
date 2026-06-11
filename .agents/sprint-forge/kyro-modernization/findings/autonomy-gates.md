---
title: "Finding — Autonomy Gates"
date: "2026-06-11"
scope: "kyro-modernization"
type: "finding"
status: "open"
severity: "medium"
target_sprint: 4
---

# Finding — Autonomy Gates

## Summary

Kyro currently uses mandatory free-text approval gates for all major phases.

## Impact

Strict gates protect quality but can become friction in modern agent loops. Auto-only loops move faster but lose the human safety checks that define Kyro.

## Recommendation

Add `gates.mode = strict | standard | auto` and `always_gate` to `config.json`, with structured prompts and an audit trail in `state.json`.
