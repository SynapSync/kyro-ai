---
title: "Finding — Deterministic Layer"
date: "2026-06-11"
scope: "kyro-modernization"
type: "finding"
status: "open"
severity: "high"
target_sprint: 1
---

# Finding — Deterministic Layer

## Summary

Kyro currently relies on prose instructions for checks that should be enforced by code: post-edit scans, secret detection, quality gates, sprint numbering, debt inheritance, and metrics aggregation.

## Impact

Prompt-only enforcement is fragile, consumes context, and varies by model/harness. Deterministic scripts let Kyro compete with modern harnesses while remaining portable.

## Recommendation

Add a `scripts/` substrate with stable exit codes and JSON output, then wire scripts through hooks where available and explicit command calls where hooks are unavailable.
