---
title: "Finding: Debugger agent has no skill declaration"
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

# Finding: Debugger agent has no skill declaration

## Summary

The explorer, reviewer, and orchestrator agents all have explicit `skills: [...]` in their frontmatter. The debugger agent does not. While it operates on generic debugging methodology (no dedicated skill), this inconsistency is notable because all other agents follow the pattern and the CLAUDE.md architecture section implies all agents connect to skills.

## Severity / Impact

medium -- The debugger works fine without a skill (it uses general-purpose tools), but the inconsistency breaks the documented Command -> Agent -> Skill -> Hook pipeline. New contributors may wonder if a skill was accidentally omitted.

## Details

- `agents/explorer.md`: `skills: ["kyro-analyzer"]`
- `agents/reviewer.md`: `skills: ["kyro-reviewer"]`
- `agents/orchestrator.md`: `skills: ["sprint-forge"]`
- `agents/debugger.md`: no `skills` field

The debugger is the only agent without a corresponding skill. There is no `kyro-debugger` skill in the skills directory.

## Affected Files

- `agents/debugger.md` (frontmatter)

## Recommendations

1. Either add `skills: []` explicitly to signal "no skill needed" (intentional)
2. Or create a minimal `kyro-debugger` skill with debugging heuristics and patterns
3. Document the exception in CLAUDE.md architecture section
