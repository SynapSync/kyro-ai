---
title: "Finding: TaskCompleted hook relies on non-standard Claude Code event"
date: "2026-03-10"
project: "kyro-workflow"
type: "analysis"
status: "active"
severity: "high"
category: "fragile-pattern"
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

# Finding: TaskCompleted hook relies on non-standard Claude Code event

## Summary

hooks.json registers a `TaskCompleted` hook event, but Claude Code's documented hook lifecycle events are: PreToolUse, PostToolUse, PostToolUseFailure, PreCompact, Stop, SubagentStart, SubagentStop, UserPromptSubmit, SessionStart, SessionEnd. `TaskCompleted` is not a standard Claude Code hook event -- it appears to be a custom/aspirational event that the runtime may never fire.

## Severity / Impact

high -- If `TaskCompleted` is never fired by Claude Code, the task-complete.js script never runs. This means: (a) the post-task quality checklist is never triggered automatically, (b) tasks_completed in .active-session is never incremented by the hook, and (c) session stats are always 0 for tasks_completed.

## Details

The hooks.json file declares these events:
- SessionStart, PreToolUse, PostToolUse, Stop, SessionEnd, UserPromptSubmit, PreCompact, SubagentStart, SubagentStop -- all standard Claude Code events
- TaskCompleted -- NOT a standard Claude Code hook event
- PostToolUseFailure -- standard

The task-complete.js script is well-implemented but likely never invoked.

## Affected Files

- `hooks/hooks.json` (TaskCompleted entry)
- `scripts/task-complete.js`

## Recommendations

1. Verify whether Claude Code supports `TaskCompleted` as a hook event (check Claude Code plugin docs)
2. If not supported, move the task-completion logic into the orchestrator agent's task execution loop
3. Consider using `SubagentStop` as a proxy for task completion
