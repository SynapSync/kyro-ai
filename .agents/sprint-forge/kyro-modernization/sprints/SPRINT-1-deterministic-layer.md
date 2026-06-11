---
title: "Sprint 1 — Deterministic Layer"
date: "2026-06-11"
updated: "2026-06-11"
scope: "kyro-modernization"
type: "sprint-plan"
status: "completed"
version: "1.0"
sprint: 1
progress: 100
previous_doc: "[[SPRINT-0-quick-wins]]"
next_doc: "[[SPRINT-2-structured-state]]"
parent_doc: "[[ROADMAP]]"
agents:
  - "gpt-5.5"
tags:
  - "kyro-modernization"
  - "sprint-plan"
  - "sprint-1"
changelog:
  - version: "1.0"
    date: "2026-06-11"
    changes: ["Sprint generated and completed"]
related:
  - "[[ROADMAP]]"
  - "[[deterministic-layer]]"
---

# Sprint 1 — Deterministic Layer

> Source: `findings/deterministic-layer.md`
> Previous Sprint: `sprints/SPRINT-0-quick-wins.md`
> Version Target: 3.4.0
> Type: feature
> Carry-over: 2 items from previous sprint debt
> Execution Date: 2026-06-11
> Executed By: gpt-5.5

---

## Sprint Objective

Replace fragile prompt-only checkpoint behavior with portable scripts and thin hook adapters while preserving manual-validation preferences.

---

## Disposition of Previous Sprint Recommendations

| # | Recommendation | Action | Where | Justification |
|---|---------------|--------|-------|---------------|
| 1 | Standardize deterministic scripts around explicit exit codes and machine-readable output. | Incorporated | Phase 1 | `scripts/lib/workflow-utils.js` defines shared result output and failure handling. |
| 2 | Add script documentation before expanding hook integration. | Incorporated | Phase 3 | `docs/agent-adapters.md` documents commands and fallbacks. |
| 3 | Keep checkpoint prose short and point it at scripts. | Incorporated | Phase 3 | `agents/orchestrator.md` now invokes `npm run check:*` scripts. |

---

## Phases

### Phase 1 — Script Substrate

**Objective**: Establish shared deterministic-script conventions.

**Tasks**:

- [x] **T1.1**: Add shared script utilities.
  - Files: `scripts/lib/workflow-utils.js`
  - Evidence: Root resolution, changed-file discovery, and JSON pass/fail output are centralized.
  - Verification: Manual CLI verification was not run per user preference.

### Phase 2 — Enforcement Scripts

**Objective**: Add standalone scripts for core workflow invariants.

**Tasks**:

- [x] **T2.1**: Add post-edit scan.
  - Files: `scripts/post-edit-scan.js`
  - Evidence: Scans changed source files for debug artifacts and conservative secret patterns.

- [x] **T2.2**: Add pre-commit checkpoint.
  - Files: `scripts/pre-commit-checkpoint.js`
  - Evidence: Reads quality gates from `config.json`, runs post-edit scan, and supports `--skip-quality`.

- [x] **T2.3**: Add deterministic sprint numbering.
  - Files: `scripts/sprint-number.js`
  - Evidence: Resolves latest and next sprint numbers from the scope sprint directory.

- [x] **T2.4**: Add markdown debt inheritance check.
  - Files: `scripts/debt-inherit.js`
  - Evidence: Verifies current sprint debt rows include previous sprint debt IDs.

- [x] **T2.5**: Add metrics aggregation.
  - Files: `scripts/metrics-aggregate.js`
  - Evidence: Aggregates sprint file progress and estimate/actual totals.

- [x] **T2.6**: Expose deterministic scripts through stable package commands.
  - Files: `package.json`
  - Evidence: `check:*` and `kyro:*` scripts are available.

### Phase 3 — Hook Integration and Prose Reduction

**Objective**: Wire scripts into adapters and reduce instruction duplication.

**Tasks**:

- [x] **T3.1**: Add Claude Code hook adapter.
  - Files: `.claude-plugin/settings.json`
  - Evidence: `PostToolUse` edit/write hook invokes `npm run check:post-edit --silent`.

- [x] **T3.2**: Document multi-harness fallback commands.
  - Files: `docs/agent-adapters.md`
  - Evidence: Claude, Codex, OpenCode, and Cursor paths point at the same scripts.

- [x] **T3.3**: Rewrite orchestrator checkpoints to invoke scripts.
  - Files: `agents/orchestrator.md`
  - Evidence: Post-edit and pre-commit checkpoint sections now call `npm run check:post-edit` and `npm run check:pre-commit`.

---

## Findings Consolidation

| # | Finding | Origin Phase | Impact | Action Taken |
|---|---------|-------------|--------|-------------|
| 1 | Manual-validation workflows need a way to avoid automatic quality gates. | Phase 2 | medium | Added `--skip-quality` to `pre-commit-checkpoint`. |
| 2 | Version sync is itself a deterministic invariant. | Phase 2 | medium | Converted `check-version-sync` to the shared JSON output contract. |

---

## Accumulated Technical Debt

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1 | Sprint 1 should move checkpoint enforcement from prose to scripts and hooks. | `findings/deterministic-layer.md` | Sprint 1 | resolved | Sprint 1 |
| 2 | Sprint 2 should make debt and metrics state machine-checkable through `state.json`. | `findings/structured-state.md` | Sprint 2 | open | — |
| 3 | `debt-inherit` currently parses markdown and should be retargeted to `state.json` after Sprint 2 lands. | Sprint 1 Phase 2 | Sprint 2 | open | — |

---

## Definition of Done

- [x] All phase tasks completed or explicitly skipped with justification
- [x] Accumulated debt table updated
- [x] Retro section filled
- [x] Recommendations for next sprint documented
- [x] Re-entry prompts updated to reflect current state
- [x] Build, lint, typecheck, and tests were not run, per user preference

---

## Retro

### What Went Well

- The scripts share one small utility module, which keeps future deterministic checks consistent.
- The first guard found and absorbed real metadata drift from Sprint 0.

### What Didn't Go Well

- Hook config is necessarily adapter-specific, so fallback documentation is required for non-Claude harnesses.

### Surprises / Unexpected Findings

- The pre-commit checkpoint needed an explicit `--skip-quality` mode to respect manual-validation workflows without weakening the script's default behavior.

### New Technical Debt Detected

- D3: Retarget markdown-based debt inheritance to `state.json` during Sprint 2.

---

## Recommendations for Sprint 2

1. Make `state.json` the canonical source for debt rows before expanding debt inheritance logic further.
2. Keep markdown renderers deterministic and byte-stable so evals can assert generated output.
3. Preserve the `--skip-quality` path when state-aware pre-commit checks are added.
