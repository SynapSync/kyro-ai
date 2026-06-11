---
title: "Sprint 9 — Eval Hardening & QA Cleanup"
date: "2026-06-11"
updated: "2026-06-11"
scope: "kyro-modernization"
type: "sprint-plan"
status: "completed"
version: "1.0"
sprint: 9
progress: 100
previous_doc: "[[SPRINT-8-harness-parity]]"
next_doc: "[[SPRINT-10-harness-apply]]"
parent_doc: "[[ROADMAP]]"
agents:
  - "cursor-agent"
tags:
  - "kyro-modernization"
  - "sprint-plan"
  - "sprint-9"
  - "eval-hardening"
changelog:
  - version: "1.0"
    date: "2026-06-11"
    changes: ["Sprint generated and completed"]
related:
  - "[[ROADMAP]]"
  - "[[eval-hardening]]"
---

# Sprint 9 — Eval Hardening & QA Cleanup

> Source: `findings/eval-hardening.md`
> Previous Sprint: `sprints/SPRINT-8-harness-parity.md`
> Version Target: 3.11.0
> Type: feature
> Execution Date: 2026-06-11

---

## Sprint Objective

Close deferred eval gaps from Sprints 5 and 8 by testing runtime gate and rules-memory behavior in isolated temp projects, retire the QA legacy fallback now guarded by evals, and ship a harness detection helper.

---

## Disposition of Previous Sprint Recommendations

| # | Recommendation | Disposition | Notes |
|---|----------------|-------------|-------|
| 1 | Add `harness detect` CLI helper that prints suggested `config.harness` for known hosts. | ADOPTED | `scripts/harness-detect.js` + `npm run kyro:harness-detect` |
| 2 | Complete gate-audit and rules-memory eval scenarios with isolated temp state. | ADOPTED | `evals/lib/temp-project.js` + 3 new scenarios |
| 3 | Retire qa-review legacy reference when eval coverage is sufficient. | ADOPTED | Legacy file removed; progressive-only eval guards routing |
| 4 | Add server-specific MCP memory adapters after API selection. | DEFERRED | No target MCP API selected yet |

---

## Phases

- [x] **T1.1**: Add `evals/lib/temp-project.js` for disposable project roots.
- [x] **T2.1**: Add `scenarioGateUnknownFailsClosed` and `scenarioGateAutoAuditUsesTempState`.
- [x] **T2.2**: Add `scenarioRulesMemorySyncAndQuery` with temp rules files.
- [x] **T3.1**: Add `scripts/harness-detect.js` and document it in `docs/agent-adapters.md`.
- [x] **T4.1**: Remove `legacy-full-audit-reference.md` and update `qa-review/SKILL.md`.
- [x] **T4.2**: Add `scenarioQaReviewProgressiveOnly` eval guard.
- [x] **T5.1**: Bump version to 3.11.0 across canonical metadata files.

---

## Accumulated Technical Debt

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1–8 | (inherited rows) | Sprints 0–7 | — | resolved | Sprints 0–7 |
| 9 | Eval gate audit with temp-state pattern to avoid mutating fixtures. | Sprint 5 retro | Sprint 9 | resolved | Sprint 9 |
| 10 | Retire qa-review legacy fallback after broader eval coverage. | Sprint 7 retro | Sprint 9 | resolved | Sprint 9 |
| 11 | MCP server-specific memory adapters after API selection. | Sprint 7 retro | TBD | open | — |
| 12 | Runtime harness auto-detection instead of manual `config.harness` edits. | Sprint 8 retro | Sprint 10+ | open | — |

---

## Retro

### What Went Well

- Temp-project eval helper keeps fixtures immutable while exercising real scripts.
- Eval count grew from 12 to 17 scenarios without slowing CI materially.
- Removing the 660-line QA legacy file completes the Sprint 3 token-economy goal.

### What Didn't Go Well

- Harness detect relies on environment heuristics; hosts without signal env vars still default to `generic`.

### Surprises / Unexpected Findings

- `gate-decision.js` already supported temp projects through `KYRO_PROJECT_DIR`; only the eval harness needed the wrapper.

### New Technical Debt Detected

- D12: Optional runtime application of `harness-detect` output to `config.json` (deferred).

---

## Recommendations for Future Roadmap

1. Add MCP server-specific memory bridge once a target API is chosen (D11).
2. Consider `kyro:harness-detect --apply` to merge suggested harness config safely.
3. Add agent-driven eval tier for orchestrator prose regressions (opt-in, not CI-blocking).
