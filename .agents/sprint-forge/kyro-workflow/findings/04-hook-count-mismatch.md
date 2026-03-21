---
title: "Finding: Hook count claims do not match reality"
date: "2026-03-10"
project: "kyro-workflow"
type: "analysis"
status: "active"
severity: "medium"
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

# Finding: Hook count claims do not match reality

## Summary

Multiple sources claim "12 hooks" but the actual counts vary. hooks.json contains 11 hook events with 15 hook entries. WORKFLOW.yaml lists 11 hook events. The plugin manifests and CLAUDE.md say "12 hooks." The discrepancy creates confusion about the actual hook surface.

## Severity / Impact

medium -- Inaccurate documentation misleads contributors and users about the workflow's capabilities. Not a runtime issue but an integrity signal.

## Details

**Claimed**: "12 hooks" (in .claude-plugin/plugin.json, CLAUDE.md)

**Actual in hooks.json**: 11 hook events (SessionStart, PreToolUse, PostToolUse, Stop, SessionEnd, UserPromptSubmit, PreCompact, SubagentStart, SubagentStop, TaskCompleted, PostToolUseFailure), containing 15 individual hook entries (some events have multiple hooks).

**WORKFLOW.yaml**: Lists 11 hook events.

**CLAUDE.md**: States "12 hook definitions" in the directory structure comment.

The confusion stems from counting hook events (11) vs hook entries (15) vs some other enumeration (12).

## Affected Files

- `.claude-plugin/plugin.json:4`
- `CLAUDE.md` (directory structure comment)
- `WORKFLOW.yaml:41-51`
- `hooks/hooks.json`

## Recommendations

1. Standardize on "11 hook events" or "15 hook entries" -- pick one and be consistent
2. Update all references to match the actual count
