---
title: "Sprint 3 — Document Generated Artifact and Release Policy"
date: "2026-06-19"
updated: "2026-06-19"
scope: "00-p0-reproducibility-and-ci"
type: "sprint-plan"
status: "active"
version: "1.0"
sprint: 3
progress: 0
previous_doc: "[[SPRINT-002-enforce-freshness-and-adapter-ci-gates]]"
next_doc: null
parent_doc: "[[ROADMAP]]"
agents:
  - "codex"
tags:
  - "00-p0-reproducibility-and-ci"
  - "sprint-plan"
  - "sprint-3"
  - "reproducibility"
  - "docs"
  - "release"
changelog:
  - version: "1.0"
    date: "2026-06-19"
    changes: ["Sprint generated from P0 reproducibility roadmap"]
related:
  - "[[ROADMAP]]"
  - "[[03-generated-artifact-policy-gap]]"
---

# Sprint 3 — Document Generated Artifact and Release Policy

> Source: `findings/03-generated-artifact-policy-gap.md`
> Previous Sprint: `phases/SPRINT-002-enforce-freshness-and-adapter-ci-gates.md`
> Version Target: 3.4.x
> Type: docs
> Carry-over: 0 items from previous sprint
> Execution Date: TBD
> Executed By: TBD

---

## Sprint Objective

Close the P0 reproducibility scope by documenting the generated artifact policy and release gate ordering that Sprints 1 and 2 made possible. This sprint produces a maintainer-facing release checklist, updates existing CLI and README docs to reference the new gates, hardens `prepublishOnly` so local publishes cannot skip freshness or adapter checks, and refreshes the 3.4.0 release notes to reflect the runtime parity and CI enforcement work.

---

## Disposition of Previous Sprint Recommendations

| # | Recommendation | Action | Where | Justification |
|---|---------------|--------|-------|---------------|
| 1 | Document generated artifact policy (REP-005) | Incorporated | Phase 1, T1.1–T1.3 | Core objective of this sprint; explains when and how `dist/` must be rebuilt, checked, committed, and packed. |
| 2 | Add release checklist | Incorporated | Phase 1, T1.1 | Core objective; creates a concise, command-by-command reference for maintainers. |
| 3 | Prepare release notes for 3.4.x | Incorporated | Phase 3, T3.1 | The existing `docs/release-3.4.0.md` predates the reproducibility work and must be updated to mention the Sprint 1 and Sprint 2 fixes. |
| 4 | Consider a `prepublishOnly` safety net | Incorporated | Phase 2, T2.1–T2.3 | Prevents local publishes from bypassing the gates validated in CI; implementation is small and directly supports the release policy. |

**Actions**:
- **Incorporated**: Added as a task in this sprint. Specify phase and task.
- **Deferred**: Postponed to a future sprint. Specify target sprint and justify.
- **Resolved**: Already resolved by previous work. Explain when/how.
- **N/A**: No longer applicable. Explain why.
- **Converted to Phase**: Recommendation was significant enough to become an entire phase (not just a task). Specify which phase.

---

## Phases

### Phase 1 — Policy Draft

**Objective**: Document generated artifact ownership and release gate ordering for maintainers, referencing the real commands verified in Sprints 1 and 2.

**Tasks**:

- [x] **T1.1**: Create `docs/release-checklist.md` with the exact release gate ordering.
  - Files: `docs/release-checklist.md`
  - Evidence:
    - Created `docs/release-checklist.md` covering:
      - Generated artifact policy (`dist/` is produced from `src/`).
      - Exact release gate ordering: `npm run check` → `npm run build` → `npm run check:adapters` → token/artifact checks → `npm pack --dry-run`.
      - CI behavior reference matching `.github/workflows/ci.yml`.
      - Local publish safety net referencing `prepublishOnly`.
      - Pre-commit checklist.
    - `npm run check:links` output:
      ```
      > node scripts/check-markdown-links.mjs
      All relative links valid (49 files checked)
      ```
  - Verification: File exists, markdown link check passes, and commands match the current `package.json` / CI workflow.

- [x] **T1.2**: Update `docs/cli.md` to document the new `check:dist` and `check:adapters` scripts.
  - Files: `docs/cli.md`
  - Evidence:
    - Added a "Maintenance Scripts" section to `docs/cli.md` covering:
      - `npm run check:dist` — purpose, when to run it, and exit behavior.
      - `npm run check:adapters` — purpose and what it exercises.
      - Full release validation sequence with a link to `docs/release-checklist.md`.
    - `npm run check:links` output:
      ```
      > node scripts/check-markdown-links.mjs
      All relative links valid (49 files checked)
      ```
  - Verification: `npm run check:links` passes and the descriptions accurately reflect script behavior.

- [x] **T1.3**: Update `README.md` with a short "Generated artifacts and release process" section.
  - Files: `README.md`
  - Evidence:
    - Added "Generated Artifacts and Release Process" section to `README.md` with:
      - Statement that `dist/` is generated from `src/`.
      - Pre-commit/release command block (`npm run check`, `npm run build`, `npm run check:adapters`, `npm pack --dry-run`).
      - Explanation of `check:dist` and `check:adapters`.
      - Link to `docs/release-checklist.md`.
    - `npm run check:links` output:
      ```
      > node scripts/check-markdown-links.mjs
      All relative links valid (49 files checked)
      ```
  - Verification: `npm run check:links` passes and the section is discoverable from the README flow.

### Phase 2 — Prepublish Safety Net

**Objective**: Ensure a local `npm publish` cannot bypass the freshness and adapter gates that CI enforces.

**Tasks**:

- [x] **T2.1**: Update `package.json` `prepublishOnly` to run `check:dist` and `check:adapters` after build.
  - Files: `package.json`
  - Evidence:
    - Updated `prepublishOnly`:
      ```json
      "prepublishOnly": "npm run build && npm run check:dist && npm run check:adapters"
      ```
    - `npm run check:versions` still passes.
  - Verification: `npm run check:versions` still passes and `npm pack --dry-run` triggers the safety net without error.

- [x] **T2.2**: Verify `npm pack --dry-run` behaves correctly with the new `prepublishOnly`.
  - Files: `package.json`
  - Evidence:
    - `npm pack --dry-run` output:
      ```
      kyro-ai-3.4.0.tgz
      ```
    - The command triggered `prepublishOnly` (build → check:dist → check:adapters) and completed successfully on fresh `dist/`.
  - Verification: Dry-run produces `kyro-ai-3.4.0.tgz` and exits `0`.

- [x] **T2.3**: Document the `prepublishOnly` behavior in `docs/release-checklist.md`.
  - Files: `docs/release-checklist.md`
  - Evidence:
    - `docs/release-checklist.md` includes a "Local publish safety net" section with the exact `prepublishOnly` value and an explanation that `npm publish` runs the same gates as CI.
    - `npm run check:links` passes.
  - Verification: `npm run check:links` passes.

### Phase 3 — Link and Maintainer Review

**Objective**: Update release notes, run final link checks, and record any remaining release risks.

**Tasks**:

- [x] **T3.1**: Update `docs/release-3.4.0.md` to include the reproducibility fixes from Sprints 1 and 2.
  - Files: `docs/release-3.4.0.md`
  - Evidence:
    - Added a "Reproducibility and CI" section to `docs/release-3.4.0.md` covering:
      - Restored generated runtime parity (REP-001).
      - Deterministic `check:dist` gate (REP-002).
      - Adapter fixture validation in CI (REP-003).
      - Package dry-run ordering (REP-004).
      - Local publish safety net in `prepublishOnly`.
    - Updated the Validation block to match the current release gate ordering.
    - Added a link to `docs/release-checklist.md`.
  - Verification: `npm run check:links` passes and the release notes reference the actual commands.

- [x] **T3.2**: Run `npm run check:links` and record the output.
  - Files: all `.md` files touched in this sprint
  - Evidence:
    - Initial run exposed a broken relative link (`docs/release-checklist.md` from `docs/release-3.4.0.md`).
    - Fixed link to `release-checklist.md`.
    - Final `npm run check:links` output:
      ```
      > node scripts/check-markdown-links.mjs
      All relative links valid (49 files checked)
      ```
  - Verification: All relative links valid.

- [x] **T3.3**: Run the full local validation matrix one final time.
  - Files: `package.json`, `dist/**`, `.github/workflows/ci.yml`
  - Evidence:
    - Full matrix passed:
      ```
      npm run check        # typecheck + versions + links + check:dist → dist/ is fresh
      npm run build        # regenerated dist/
      npm run check:adapters → Adapter fixtures passed
      npm run check:tokens → passed
      npm run check:artifacts → passed
      npm run check:artifact-fixtures → Artifact integrity fixtures passed
      npm pack --dry-run   → kyro-ai-3.4.0.tgz
      ```
  - Verification: Full matrix passes on the current codebase.

---

## Emergent Phases

<!-- This section starts EMPTY. It is populated during sprint EXECUTION when new work is discovered. -->

---

## Findings Consolidation

| # | Finding | Origin Phase | Impact | Action Taken |
|---|---------|-------------|--------|-------------|
| 1 | `docs/release-3.4.0.md` had a stale validation block that did not include `check:dist` or `check:adapters`. | Phase 3 | Release notes would mislead maintainers about the current validation sequence. | Replaced the validation block with the full current gate ordering and added a "Reproducibility and CI" section. |
| 2 | Relative link from `docs/release-3.4.0.md` to `docs/release-checklist.md` must be `release-checklist.md`, not `docs/release-checklist.md`. | Phase 3 | Broke `npm run check:links` until corrected. | Fixed the relative path and re-ran link check. |
| 3 | `npm pack --dry-run` triggers `prepublishOnly`, so the safety net is exercised even during dry-run. | Phase 2 | Confirms local publish safety net works without requiring an actual publish. | Recorded in T2.2 evidence and documented in `docs/release-checklist.md`. |

---

## Accumulated Technical Debt

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1 | Add deterministic `check:dist` so future source/runtime drift fails before merge. | Strategic audit REP-002 | Sprint 2 | resolved | Sprint 2 |
| 2 | Add `npm run check:adapters` to CI so adapter regressions cannot escape. | Strategic audit REP-003 | Sprint 2 | resolved | Sprint 2 |
| 3 | Document generated artifact and release verification policy after technical gates exist. | Strategic audit REP-005 | Sprint 3 | resolved | Sprint 3 |

**Status values**: `open` | `in-progress` | `resolved` | `deferred` | `carry-over`

**Rules**:
- Never delete a row — only change status
- New items are appended at the bottom
- Inherited items keep their original numbers
- When resolved, fill "Resolved In" with the sprint number

---

## Definition of Done

- [x] `docs/release-checklist.md` created with exact release gate ordering.
- [x] `docs/cli.md` updated to document `check:dist` and `check:adapters`.
- [x] `README.md` updated with a generated artifacts / release process section.
- [x] `package.json` `prepublishOnly` updated to run freshness and adapter gates.
- [x] `docs/release-3.4.0.md` updated with Sprint 1 and Sprint 2 reproducibility fixes.
- [x] `npm run check:links` passes.
- [x] Full local validation matrix passes.
- [x] Debt table updated with Sprint 3 item marked `resolved`.
- [x] Retro section filled before close.
- [x] Recommendations for next sprint documented before close.
- [x] Re-entry prompts and summary JSON refreshed at close.

---

## Retro

### What Went Well

- All documentation tasks stayed tightly scoped to the reproducibility theme and referenced real commands verified in Sprints 1 and 2.
- The `prepublishOnly` safety net was a one-line change with immediate validation through `npm pack --dry-run`.
- `docs/release-checklist.md` now gives maintainers a single source of truth for the release gate ordering.

### What Didn't Go Well

- The relative link from `docs/release-3.4.0.md` to `docs/release-checklist.md` was initially wrong, requiring a second `npm run check:links` pass.
- The existing `docs/release-3.4.0.md` had a stale validation block that did not reflect the new gates, so it needed more than a simple append.

### Surprises / Unexpected Findings

- `npm pack --dry-run` triggers `prepublishOnly`, which means the local publish safety net is validated automatically every time a maintainer dry-runs a pack.
- The P0 reproducibility scope is now fully closed: all three sprints completed, all roadmap debt resolved, and the generated artifact policy is documented.

### New Technical Debt Detected

- None. Debt item #3 was resolved in this sprint; no new debt was introduced.

---

## Recommendations for Next Sprint

<!-- Filled when the sprint is CLOSED. Each recommendation becomes a candidate task for the next sprint. -->

1. **Monitor the new CI gates for flakiness** in the first few pull requests after merge; `check:dist` does a full TypeScript build and could become slow as `src/` grows.
2. **Consider caching `node_modules` and `dist/` in CI** to speed up `check:dist`, but only if the cache invalidation strategy preserves the freshness guarantee.
3. **Schedule a periodic review** of `docs/release-checklist.md` and `docs/release-3.4.0.md` when new adapters or build steps are added, so release docs do not drift from scripts again.
4. **Close or archive the `00-p0-reproducibility-and-ci` scope** in project state now that the roadmap is complete.
