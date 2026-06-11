---
title: "Sprint 0 — Quick Wins & Hygiene"
date: "2026-06-11"
updated: "2026-06-11"
scope: "kyro-modernization"
type: "sprint-plan"
status: "completed"
version: "1.0"
sprint: 0
progress: 100
previous_doc: null
next_doc: "[[SPRINT-1-deterministic-layer]]"
parent_doc: "[[ROADMAP]]"
agents:
  - "gpt-5.5"
tags:
  - "kyro-modernization"
  - "sprint-plan"
  - "sprint-0"
changelog:
  - version: "1.0"
    date: "2026-06-11"
    changes: ["Sprint generated and completed"]
related:
  - "[[ROADMAP]]"
  - "[[quick-wins]]"
---

# Sprint 0 — Quick Wins & Hygiene

> Source: `findings/quick-wins.md`
> Previous Sprint: None
> Version Target: 3.3.1
> Type: debt
> Carry-over: 0 items
> Execution Date: 2026-06-11
> Executed By: gpt-5.5

---

## Sprint Objective

Restore baseline repository integrity before deeper modernization by fixing confirmed documentation drift, metadata drift, empty source directories, and duplicated command lifecycle text.

---

## Phases

### Phase 1 — Doc Integrity

**Objective**: Remove stale or broken references from active docs.

**Tasks**:

- [x] **T1.1**: Fix broken Obsidian standard link in `skills/sprint-forge/SKILL.md`.
  - Files: `skills/sprint-forge/SKILL.md`
  - Evidence: The missing `../integrations/obsidian/...` link was replaced with a local-template reference.
  - Verification: Text search shows remaining references only inside modernization findings/roadmap evidence.

- [x] **T1.2**: Update stale `Kyro v2.0` references.
  - Files: `skills/sprint-forge/SKILL.md`, `docs/architecture.md`
  - Evidence: Active docs now describe Kyro 3.x / v3.3 behavior.
  - Verification: Text search found no active stale `Kyro v2.0` references outside modernization evidence.

### Phase 2 — Dead Code Removal

**Objective**: Remove empty aspirational directories.

**Tasks**:

- [x] **T2.1**: Remove empty `src/db/` and `src/search/` directories.
  - Files: `src/db/`, `src/search/`
  - Evidence: Directories were removed with `rmdir`, which succeeds only when empty.
  - Verification: `src/index.ts` remains as the intentional package entry.

### Phase 3 — Version Sync Guard

**Objective**: Prevent future metadata version drift.

**Tasks**:

- [x] **T3.1**: Add `scripts/check-version-sync.js`.
  - Files: `scripts/check-version-sync.js`, `package.json`
  - Evidence: Script compares `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `WORKFLOW.yaml`.
  - Verification: Manual validation was not run per user preference.

- [x] **T3.2**: Wire version sync into CI and release workflows.
  - Files: `.github/workflows/ci.yml`, `.github/workflows/release.yml`
  - Evidence: Both workflows call `npm run check:versions` after dependency install.
  - Verification: CI will enforce on push/release.

- [x] **T3.3**: Trim `commands/forge.md` into a delegating wrapper.
  - Files: `commands/forge.md`
  - Evidence: Lifecycle details now live in `agents/orchestrator.md`.
  - Verification: Command retains frontmatter and target argument contract.

---

## Findings Consolidation

| # | Finding | Origin Phase | Impact | Action Taken |
|---|---------|-------------|--------|-------------|
| 1 | `package-lock.json` was still at `3.2.0` while package metadata was `3.3.0` | Phase 3 | medium | Included in version-sync script and bumped to `3.3.1` |
| 2 | `docs/architecture.md` contained a stale `Kyro v2.0` reference | Phase 1 | low | Updated to Kyro 3.x language |

---

## Accumulated Technical Debt

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1 | Sprint 1 should move checkpoint enforcement from prose to scripts and hooks. | `findings/deterministic-layer.md` | Sprint 1 | open | — |
| 2 | Sprint 2 should make debt and metrics state machine-checkable through `state.json`. | `findings/structured-state.md` | Sprint 2 | open | — |

---

## Definition of Done

- [x] All phase tasks completed or explicitly skipped with justification
- [x] Accumulated debt table updated
- [x] Retro section filled
- [x] Recommendations for next sprint documented
- [x] Re-entry prompts updated to reflect current state
- [x] No build, lint, typecheck, or test commands were run, per user preference

---

## Retro

### What Went Well

- The quick wins were tightly scoped and resolved without broad refactors.
- The new version guard catches an existing lockfile drift that was not in the initial quick-win list.

### What Didn't Go Well

- The repository's historical version metadata had already diverged in `package-lock.json`, so the new guard needed to cover more files than the original checklist explicitly named.

### Surprises / Unexpected Findings

- `docs/architecture.md` also contained stale v2-era wording.

### New Technical Debt Detected

- No new unrelated debt was introduced. The two open debt rows intentionally represent the next planned modernization foundations.

---

## Recommendations for Sprint 1

1. Treat `scripts/check-version-sync.js` as the first example of the deterministic-script contract and standardize future scripts around explicit exit codes plus machine-readable output.
2. Add script documentation before expanding hook integration so the multi-harness fallback remains easy to understand.
3. Keep checkpoint prose in `agents/orchestrator.md` short and point it at scripts as they land.
