---
title: "Sprint 10 — Harness Apply & MCP Bridge Prep"
date: "2026-06-11"
updated: "2026-06-11"
scope: "kyro-modernization"
type: "sprint-plan"
status: "planned"
version: "1.0"
sprint: 10
progress: 0
previous_doc: "[[SPRINT-9-eval-hardening]]"
next_doc: null
parent_doc: "[[ROADMAP]]"
agents: []
tags:
  - "kyro-modernization"
  - "sprint-plan"
  - "sprint-10"
  - "harness-apply"
changelog:
  - version: "1.0"
    date: "2026-06-11"
    changes: ["Sprint planned from Sprint 9 retro"]
related:
  - "[[ROADMAP]]"
---

# Sprint 10 — Harness Apply & MCP Bridge Prep

> Source: Sprint 9 retro + open debt D11–D12
> Previous Sprint: `sprints/SPRINT-9-eval-hardening.md`
> Version Target: 3.12.0
> Type: feature
> Status: **planned** (not started)

---

## Sprint Objective

Make harness setup one command instead of manual `config.json` edits, and prepare the MCP memory bridge interface without committing to a single server API.

---

## Disposition of Previous Sprint Recommendations

| # | Recommendation | Disposition | Notes |
|---|----------------|-------------|-------|
| 1 | Add MCP server-specific memory bridge once a target API is chosen. | PARTIAL | Ship adapter interface + stub; full bridge waits on API choice (D11) |
| 2 | Add `kyro:harness-detect --apply` to merge suggested harness config safely. | ADOPTED | Primary deliverable |
| 3 | Add agent-driven eval tier for orchestrator prose regressions (opt-in). | DEFERRED | Sprint 11+ |

---

## Phases

### Phase 1 — Harness Apply

- [ ] **T1.1**: Extend `scripts/harness-detect.js` with `--apply` and `--dry-run` flags.
- [ ] **T1.2**: Merge only `config.harness` (never gates, memory, or sprint settings).
- [ ] **T1.3**: Add eval scenario for dry-run apply without mutating repo `config.json`.
- [ ] **T1.4**: Document apply workflow in `docs/agent-adapters.md`.

### Phase 2 — MCP Bridge Prep

- [ ] **T2.1**: Add `scripts/lib/memory-bridge.js` with `sync` / `query` interface.
- [ ] **T2.2**: Wire `rules-memory.js` through the bridge (local index remains default).
- [ ] **T2.3**: Add `memory.provider: local | mcp` to `config.json` (default `local`).
- [ ] **T2.4**: Document provider contract in `docs/memory-adapter.md`.

### Phase 3 — Release

- [ ] **T3.1**: Bump version to 3.12.0 across canonical metadata files.
- [ ] **T3.2**: Extend eval count and CI if new scenarios are added.

---

## Accumulated Technical Debt

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1–10 | (inherited resolved rows) | Sprints 0–9 | — | resolved | Sprints 0–9 |
| 11 | MCP server-specific memory adapters after API selection. | Sprint 7 retro | Sprint 10 (partial) | open | — |
| 12 | Runtime harness auto-detection or `--apply` for harness-detect output. | Sprint 9 retro | Sprint 10 | open | — |

---

## Exit Criteria

- `npm run kyro:harness-detect -- --dry-run` prints a merge preview.
- `npm run kyro:harness-detect -- --apply` updates only `harness` in project `config.json`.
- Memory bridge interface exists; `local` provider behavior is unchanged.
- Eval suite passes with new harness-apply scenarios.

---

## Out of Scope

- Choosing or implementing a specific MCP memory server (Engram, claude-mem, etc.).
- Agent-driven LLM eval tier (deferred).
- Auto-detection without explicit `--apply` on every host boot.
