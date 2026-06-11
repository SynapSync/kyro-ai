---
title: "Sprint 10 — Harness Apply & MCP Bridge Prep"
date: "2026-06-11"
updated: "2026-06-11"
scope: "kyro-modernization"
type: "sprint-plan"
status: "completed"
version: "1.0"
sprint: 10
progress: 100
previous_doc: "[[SPRINT-9-eval-hardening]]"
next_doc: null
parent_doc: "[[ROADMAP]]"
agents:
  - "cursor-agent"
tags:
  - "kyro-modernization"
  - "sprint-plan"
  - "sprint-10"
  - "harness-apply"
changelog:
  - version: "1.0"
    date: "2026-06-11"
    changes: ["Sprint planned and completed"]
related:
  - "[[ROADMAP]]"
---

# Sprint 10 — Harness Apply & MCP Bridge Prep

> Source: Sprint 9 retro + open debt D11–D12
> Previous Sprint: `sprints/SPRINT-9-eval-hardening.md`
> Version Target: 3.12.0
> Type: feature
> Execution Date: 2026-06-11

---

## Sprint Objective

Make harness setup one command instead of manual `config.json` edits, and prepare the MCP memory bridge interface without committing to a single server API.

---

## Disposition of Previous Sprint Recommendations

| # | Recommendation | Disposition | Notes |
|---|----------------|-------------|-------|
| 1 | Add MCP server-specific memory bridge once a target API is chosen. | PARTIAL | `memory-bridge.js` ships sync/query stub for `mcp` provider |
| 2 | Add `kyro:harness-detect --apply` to merge suggested harness config safely. | ADOPTED | `--dry-run` and `--apply` implemented |
| 3 | Add agent-driven eval tier for orchestrator prose regressions (opt-in). | DEFERRED | Sprint 11+ |

---

## Phases

- [x] **T1.1**: Extend `scripts/harness-detect.js` with `--apply` and `--dry-run` flags.
- [x] **T1.2**: Merge only `config.harness` (never gates, memory, or sprint settings).
- [x] **T1.3**: Add eval scenarios for dry-run and apply in temp projects.
- [x] **T1.4**: Document apply workflow in `docs/agent-adapters.md`.
- [x] **T2.1**: Add `scripts/lib/memory-bridge.js` with `sync` / `query` interface.
- [x] **T2.2**: Wire `rules-memory.js` through the bridge (local index remains default).
- [x] **T2.3**: Add `memory.provider: local | mcp` to `config.json` (default `local`).
- [x] **T2.4**: Document provider contract in `docs/memory-adapter.md`.
- [x] **T3.1**: Bump version to 3.12.0 across canonical metadata files.
- [x] **T3.2**: Extend eval suite to 20 scenarios.

---

## Accumulated Technical Debt

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1–10 | (inherited resolved rows) | Sprints 0–9 | — | resolved | Sprints 0–9 |
| 11 | MCP server-specific memory adapters after API selection. | Sprint 7 retro | Sprint 10 (partial) | open | — |
| 12 | Runtime harness auto-detection or `--apply` for harness-detect output. | Sprint 9 retro | Sprint 10 | resolved | Sprint 10 |
| 13 | Agent-driven orchestrator prose eval tier (opt-in). | Sprint 10 retro | Sprint 11+ | open | — |
| 14 | MCP provider implementation once server API is selected. | Sprint 10 retro | TBD | open | — |

---

## Retro

### What Went Well

- Harness profiles extracted to `scripts/lib/harness-profiles.js` for reuse and testing.
- Temp-project evals prove `--dry-run` is non-mutating and `--apply` is scope-safe.
- Local memory behavior is unchanged while the MCP boundary is explicit.

### What Didn't Go Well

- MCP provider remains a stub; no server adapter was selected.

### Surprises / Unexpected Findings

- Legacy `mcp_enabled` can still resolve to provider `mcp` for backward compatibility.

### New Technical Debt Detected

- D13: Agent-driven eval tier.
- D14: Concrete MCP server adapter.

---

## Recommendations for Future Roadmap

1. Implement Engram or claude-mem adapter behind `memory.provider: mcp`.
2. Add opt-in LLM eval scenarios for orchestrator prose regressions.
3. Consider `kyro init` that runs `harness-detect --apply` on first project setup.
