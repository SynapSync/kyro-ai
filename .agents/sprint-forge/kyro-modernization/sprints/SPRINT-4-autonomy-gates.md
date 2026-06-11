---
title: "Sprint 4 — Configurable Autonomy Gates"
date: "2026-06-11"
updated: "2026-06-11"
scope: "kyro-modernization"
type: "sprint-plan"
status: "completed"
version: "1.0"
sprint: 4
progress: 100
previous_doc: "[[SPRINT-3-context-economy]]"
next_doc: "[[SPRINT-5-eval-harness]]"
parent_doc: "[[ROADMAP]]"
agents:
  - "gpt-5.5"
tags:
  - "kyro-modernization"
  - "sprint-plan"
  - "sprint-4"
changelog:
  - version: "1.0"
    date: "2026-06-11"
    changes: ["Sprint generated and completed"]
related:
  - "[[ROADMAP]]"
  - "[[autonomy-gates]]"
---

# Sprint 4 — Configurable Autonomy Gates

> Source: `findings/autonomy-gates.md`
> Previous Sprint: `sprints/SPRINT-3-context-economy.md`
> Version Target: 3.6.0
> Type: feature
> Carry-over: 1 item from previous sprint
> Execution Date: 2026-06-11
> Executed By: gpt-5.5

---

## Sprint Objective

Add configurable gate behavior so Kyro can support strict human approval, standard guarded execution, and auto mode with safety floors.

---

## Disposition of Previous Sprint Recommendations

| # | Recommendation | Action | Where | Justification |
|---|---------------|--------|-------|---------------|
| 1 | Store auto-approved gate decisions in `state.json.audit`. | Incorporated | Phase 2 | `gate-decision.js` writes `gate.auto_approved` entries when state exists. |
| 2 | Keep `sprint_plan` and `commit` as default `always_gate`. | Incorporated | Phase 1 | `config.json` default includes both gates. |
| 3 | Use structured option prompts without harness-specific core behavior. | Incorporated | Phase 3 | Orchestrator uses numbered options and docs explain the pattern. |

---

## Phases

- [x] **T1.1**: Add `gates` config with taxonomy, mode, and `always_gate`.
- [x] **T2.1**: Add `scripts/gate-decision.js` and `npm run kyro:gate`.
- [x] **T3.1**: Update orchestrator gate protocol to call the script.
- [x] **T3.2**: Add `docs/autonomy-gates.md`.

---

## Accumulated Technical Debt

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1 | Sprint 1 should move checkpoint enforcement from prose to scripts and hooks. | `findings/deterministic-layer.md` | Sprint 1 | resolved | Sprint 1 |
| 2 | Sprint 2 should make debt and metrics state machine-checkable through `state.json`. | `findings/structured-state.md` | Sprint 2 | resolved | Sprint 2 |
| 3 | `debt-inherit` currently parses markdown and should be retargeted to `state.json` after Sprint 2 lands. | Sprint 1 Phase 2 | Sprint 2 | resolved | Sprint 2 |
| 4 | Sprint 3 should split `qa-review` and complete lifecycle dedupe to reduce token load. | `findings/context-economy.md` | Sprint 3 | resolved | Sprint 3 |
| 5 | Sprint 4 should add configurable autonomy gates and audit gate decisions in state. | `findings/autonomy-gates.md` | Sprint 4 | resolved | Sprint 4 |
| 6 | Sprint 5 should add eval fixtures and invariant scenarios before subagent parallelism. | `findings/eval-harness.md` | Sprint 5 | open | — |

---

## Retro

### What Went Well

- Gate behavior now lives in config and script output rather than free-text-only instructions.

### What Didn't Go Well

- The gate script cannot invoke native structured-question UI directly; it provides decisions and the orchestrator handles presentation.

### Surprises / Unexpected Findings

- The `state.json.audit` structure from Sprint 2 made gate auditing straightforward.

### New Technical Debt Detected

- D6: Add eval fixtures and invariant scenarios in Sprint 5.

---

## Recommendations for Sprint 5

1. Add an eval scenario proving unknown gates fail closed.
2. Add an eval scenario proving auto gates write audit entries.
3. Keep deterministic script tests separate from agent-driven scenarios.
