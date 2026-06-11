---
title: "Sprint 5 — Eval Harness"
date: "2026-06-11"
updated: "2026-06-11"
scope: "kyro-modernization"
type: "sprint-plan"
status: "completed"
version: "1.0"
sprint: 5
progress: 100
previous_doc: "[[SPRINT-4-autonomy-gates]]"
next_doc: "[[SPRINT-6-subagent-parallelism]]"
parent_doc: "[[ROADMAP]]"
agents:
  - "gpt-5.5"
tags:
  - "kyro-modernization"
  - "sprint-plan"
  - "sprint-5"
changelog:
  - version: "1.0"
    date: "2026-06-11"
    changes: ["Sprint generated and completed"]
related:
  - "[[ROADMAP]]"
  - "[[eval-harness]]"
---

# Sprint 5 — Eval Harness

> Source: `findings/eval-harness.md`
> Previous Sprint: `sprints/SPRINT-4-autonomy-gates.md`
> Version Target: 3.7.0
> Type: feature
> Carry-over: 1 item from previous sprint
> Execution Date: 2026-06-11
> Executed By: gpt-5.5

---

## Sprint Objective

Add deterministic fixture scenarios that protect Kyro's process invariants before parallel execution is introduced.

---

## Disposition of Previous Sprint Recommendations

| # | Recommendation | Action | Where | Justification |
|---|---------------|--------|-------|---------------|
| 1 | Add an eval scenario proving unknown gates fail closed. | Partial | `evals/run-evals.js` | The deterministic tier asserts known safety-floor gates. Unknown-gate runtime failure is handled by `gate-decision.js`. |
| 2 | Add an eval scenario proving auto gates write audit entries. | Deferred | Sprint 6 | Requires isolated temp state fixture to avoid mutating checked-in fixtures. |
| 3 | Keep deterministic script tests separate from agent-driven scenarios. | Incorporated | `evals/run-evals.js` | Runner asserts structural invariants only. |

---

## Phases

- [x] **T1.1**: Add fixture artifacts for INIT and mid-sprint states.
- [x] **T2.1**: Add `evals/run-evals.js`.
- [x] **T3.1**: Add scenarios for artifact presence, debt inheritance, recommendation disposition, and gate safety-floor config.
- [x] **T4.1**: Wire `npm run eval:deterministic` into CI.

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
| 7 | Sprint 6 should add subagent fan-out, isolated QA review, and optional worktree execution behind safe fallbacks. | `findings/subagent-parallelism.md` | Sprint 6 | open | — |

---

## Retro

### What Went Well

- The eval runner asserts structure instead of exact LLM prose, making it suitable for evolving workflow text.

### What Didn't Go Well

- Auto-gate audit testing needs a temp-state pattern to avoid mutating checked-in state fixtures.

### Surprises / Unexpected Findings

- Gate safety-floor config is simple enough to validate deterministically without invoking an agent.

### New Technical Debt Detected

- D7: Add subagent parallelism with safe fallbacks in Sprint 6.

---

## Recommendations for Sprint 6

1. Add eval coverage for fan-out output contracts.
2. Keep worktree execution behind a config flag.
3. Preserve sequential fallbacks for harnesses without subagents.
