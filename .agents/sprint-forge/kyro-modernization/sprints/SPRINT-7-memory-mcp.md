---
title: "Sprint 7 — Memory MCP Adapter"
date: "2026-06-11"
updated: "2026-06-11"
scope: "kyro-modernization"
type: "sprint-plan"
status: "completed"
version: "1.0"
sprint: 7
progress: 100
previous_doc: "[[SPRINT-6-subagent-parallelism]]"
next_doc: null
parent_doc: "[[ROADMAP]]"
agents:
  - "gpt-5.5"
tags:
  - "kyro-modernization"
  - "sprint-plan"
  - "sprint-7"
changelog:
  - version: "1.0"
    date: "2026-06-11"
    changes: ["Sprint generated and completed"]
related:
  - "[[ROADMAP]]"
  - "[[memory-mcp]]"
---

# Sprint 7 — Memory MCP Adapter

> Source: `findings/memory-mcp.md`
> Previous Sprint: `sprints/SPRINT-6-subagent-parallelism.md`
> Version Target: 3.9.0
> Type: feature
> Carry-over: 1 item from previous sprint
> Execution Date: 2026-06-11
> Executed By: gpt-5.5

---

## Sprint Objective

Add optional learned-rule indexing and semantic-style query support while keeping `.agents/sprint-forge/rules.md` canonical and no-MCP behavior portable.

---

## Disposition of Previous Sprint Recommendations

| # | Recommendation | Action | Where | Justification |
|---|---------------|--------|-------|---------------|
| 1 | Keep `rules.md` canonical and treat MCP memory as a derived index. | Incorporated | `config.json`, `docs/memory-adapter.md` | Canonical policy is explicit. |
| 2 | Make memory sync a script with graceful no-server behavior. | Incorporated | `scripts/rules-memory.js` | Local index/query works without MCP. |
| 3 | Document no-MCP behavior as the default portable path. | Incorporated | `docs/memory-adapter.md` | MCP is disabled by default. |

---

## Phases

- [x] **T1.1**: Add memory config.
- [x] **T2.1**: Add `scripts/rules-memory.js`.
- [x] **T3.1**: Add `docs/memory-adapter.md`.
- [x] **T3.2**: Update learner helper and deterministic evals.

---

## Accumulated Technical Debt

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1 | Sprint 1 should move checkpoint enforcement from prose to scripts and hooks. | `findings/deterministic-layer.md` | Sprint 1 | resolved | Sprint 1 |
| 2 | Sprint 2 should make debt and metrics state machine-checkable through `state.json`. | `findings/structured-state.md` | Sprint 2 | resolved | Sprint 2 |
| 3 | `debt-inherit` currently parses markdown and should be retargeted to `state.json` after Sprint 2 lands. | Sprint 1 Phase 2 | Sprint 2 | resolved | Sprint 2 |
| 4 | Sprint 3 should split `qa-review` and complete lifecycle dedupe to reduce token load. | `findings/context-economy.md` | Sprint 3 | resolved | Sprint 3 |
| 5 | Sprint 4 should add configurable autonomy gates and audit gate decisions in state. | `findings/autonomy-gates.md` | Sprint 4 | resolved | Sprint 4 |
| 6 | Sprint 5 should add eval fixtures and invariant scenarios before subagent parallelism. | `findings/eval-harness.md` | Sprint 5 | resolved | Sprint 5 |
| 7 | Sprint 6 should add subagent fan-out, isolated QA review, and optional worktree execution behind safe fallbacks. | `findings/subagent-parallelism.md` | Sprint 6 | resolved | Sprint 6 |
| 8 | Sprint 7 should add optional MCP memory sync while keeping rules.md canonical. | `findings/memory-mcp.md` | Sprint 7 | resolved | Sprint 7 |

---

## Retro

### What Went Well

- The memory layer adds value without making any external server mandatory.

### What Didn't Go Well

- The first implementation provides local index/query and a documented MCP policy, not direct server-specific writes.

### Surprises / Unexpected Findings

- The local index is useful even without MCP because it gives agents a consistent query command.

### New Technical Debt Detected

- None for the current modernization roadmap.

---

## Recommendations for Future Roadmap

1. Add server-specific adapters only after a target MCP memory API is selected.
2. Extend evals with temp-state gate audit and rules-memory sync scenarios.
3. Consider retiring the QA legacy fallback after focused-reference eval coverage is broad enough.
