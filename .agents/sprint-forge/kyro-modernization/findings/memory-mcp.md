---
title: "Finding — Memory MCP Adapter"
date: "2026-06-11"
scope: "kyro-modernization"
type: "finding"
status: "open"
severity: "medium"
target_sprint: 7
---

# Finding — Memory MCP Adapter

## Summary

Kyro's learned rules live in `rules.md`, which preserves portability but requires agents to load or scan the full rule set.

## Impact

As learned rules grow, context usage rises and relevance drops. Modern harnesses increasingly provide memory MCP servers that can retrieve semantically relevant observations.

## Recommendation

Keep `rules.md` canonical and optionally sync it into memory MCP servers as a derived index for semantic retrieval.
