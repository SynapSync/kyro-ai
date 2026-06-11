---
title: "Sprint 8 — Harness Parity"
date: "2026-06-11"
updated: "2026-06-11"
scope: "kyro-modernization"
type: "sprint-plan"
status: "completed"
version: "1.0"
sprint: 8
progress: 100
previous_doc: "[[SPRINT-7-memory-mcp]]"
next_doc: "[[SPRINT-9-eval-hardening]]"
parent_doc: "[[ROADMAP]]"
agents:
  - "cursor-agent"
tags:
  - "kyro-modernization"
  - "sprint-plan"
  - "sprint-8"
  - "harness-parity"
changelog:
  - version: "1.0"
    date: "2026-06-11"
    changes: ["Sprint generated and completed"]
related:
  - "[[ROADMAP]]"
  - "[[harness-parity]]"
---

# Sprint 8 — Harness Parity (Multi-Agent)

> Source: `findings/harness-parity.md`
> Previous Sprint: `sprints/SPRINT-7-memory-mcp.md`
> Version Target: 3.10.0
> Type: refactor
> Execution Date: 2026-06-11

---

## Sprint Objective

Correct Claude-first perception by reinforcing the portable core, adding explicit harness configuration, shipping adapter templates, and extending evals for multi-agent portability.

---

## Disposition of Previous Sprint Recommendations

| # | Recommendation | Disposition | Notes |
|---|----------------|-------------|-------|
| 1 | Add server-specific adapters only after a target MCP memory API is selected. | DEFERRED | MCP server choice still open |
| 2 | Extend evals with temp-state gate audit and rules-memory sync scenarios. | ADOPTED (partial) | Portability evals added; gate audit temp-state deferred |
| 3 | Consider retiring the QA legacy fallback after focused-reference eval coverage is broad enough. | DEFERRED | Sprint 9+ |

---

## Phases

- [x] **T1.1**: Add `KYRO_PROJECT_DIR` / `KYRO_PACKAGE_ROOT` with `CLAUDE_*` aliases in `workflow-utils.js`.
- [x] **T1.2**: Add `config.json` → `harness` section; update orchestrator Harness Neutrality.
- [x] **T2.1**: Remove `model: opus` from contexts; fix `agents-reference.md`.
- [x] **T2.2**: Create `adapters/` (generic, cursor, kilo-code, claude-code pointer).
- [x] **T3.1**: Reorder docs generic-first; add HOW-TO-USE-CURSOR and HOW-TO-USE-KILO-CODE.
- [x] **T3.2**: Extend `evals/run-evals.js` with portability scenarios (12 total).
- [x] **T4.1**: Bump version to 3.10.0; include `adapters/` in package `files`.

---

## Accumulated Technical Debt

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1–8 | (inherited rows) | Sprints 0–7 | — | resolved | Sprints 0–7 |
| 9 | Eval gate audit with temp-state pattern to avoid mutating fixtures. | Sprint 5 retro | Sprint 9+ | open | — |
| 10 | Retire qa-review legacy fallback after broader eval coverage. | Sprint 7 retro | Sprint 9+ | open | — |
| 11 | MCP server-specific memory adapters after API selection. | Sprint 7 retro | TBD | open | — |

---

## Retro

### What Went Well

- Portable core vs adapter separation is now explicit in architecture docs and `adapters/README.md`.
- Harness config gives hosts a single place to declare capabilities without editing orchestrator prose.
- 12 eval scenarios pass including env resolution and adapter shipping checks.

### What Didn't Go Well

- No runtime auto-detection for `harness.id: auto` — hosts must set capabilities manually.

### Surprises / Unexpected Findings

- `KYRO_*` aliases were sufficient; no script call sites needed breaking changes beyond `getPackageRoot()`.

### New Technical Debt Detected

- D9: Gate audit eval with temp-state (deferred from Sprint 5).
- D10: QA legacy fallback retirement.
- D11: MCP server-specific adapters.

---

## Recommendations for Future Roadmap

1. Add `harness detect` CLI helper that prints suggested `config.harness` for known hosts.
2. Complete gate-audit and rules-memory eval scenarios with isolated temp state.
3. Retire qa-review legacy reference when eval coverage is sufficient.
