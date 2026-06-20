---
title: "Sprint 2 — Enforce Freshness and Adapter CI Gates"
date: "2026-06-19"
updated: "2026-06-19"
scope: "00-p0-reproducibility-and-ci"
type: "sprint-plan"
status: "active"
version: "1.0"
sprint: 2
progress: 0
previous_doc: "[[SPRINT-001-restore-generated-runtime-parity]]"
next_doc: "[[SPRINT-003-document-generated-artifact-and-release-policy]]"
parent_doc: "[[ROADMAP]]"
agents:
  - "codex"
tags:
  - "00-p0-reproducibility-and-ci"
  - "sprint-plan"
  - "sprint-2"
  - "reproducibility"
  - "ci"
  - "dist"
changelog:
  - version: "1.0"
    date: "2026-06-19"
    changes: ["Sprint generated from P0 reproducibility roadmap"]
related:
  - "[[ROADMAP]]"
  - "[[01-stale-generated-runtime]]"
  - "[[02-ci-adapter-coverage-gap]]"
---

# Sprint 2 — Enforce Freshness and Adapter CI Gates

> Source: `findings/01-stale-generated-runtime.md`, `findings/02-ci-adapter-coverage-gap.md`
> Previous Sprint: `phases/SPRINT-001-restore-generated-runtime-parity.md`
> Version Target: 3.4.x
> Type: validation
> Carry-over: 0 items from previous sprint
> Execution Date: TBD
> Executed By: TBD

---

## Sprint Objective

Make the trust restored in Sprint 1 durable by adding deterministic gates that prevent `dist/` drift and adapter regressions from reaching `main`. This sprint adds a `check:dist` script that proves the checked-in runtime matches a fresh build, updates CI to run adapter fixture validation, and ensures package dry-run only happens after those reproducibility gates succeed. No new documentation policy or release notes are written yet — that belongs to Sprint 3.

---

## Disposition of Previous Sprint Recommendations

| # | Recommendation | Action | Where | Justification |
|---|---------------|--------|-------|---------------|
| 1 | Add deterministic `check:dist` gate (REP-002) | Incorporated | Phase 1, T1.1–T1.3 | Core objective of this sprint; required to make Sprint 1's dist rebuild enforceable. |
| 2 | Add adapter fixture check to CI (REP-003) | Incorporated | Phase 2, T2.1–T2.3 | Core objective of this sprint; prevents adapter projection regressions from escaping. |
| 3 | Order package dry-run after freshness and adapter gates (REP-004) | Incorporated | Phase 3, T3.1–T3.3 | Core objective of this sprint; ensures releases cannot pack stale or broken runtimes. |
| 4 | Prepare release notes placeholder for regenerated `dist/` | Deferred | Sprint 3 | Release notes and generated artifact policy docs belong in the documentation/policy sprint after the technical gates exist. |

**Actions**:
- **Incorporated**: Added as a task in this sprint. Specify phase and task.
- **Deferred**: Postponed to a future sprint. Specify target sprint and justify.
- **Resolved**: Already resolved by previous work. Explain when/how.
- **N/A**: No longer applicable. Explain why.
- **Converted to Phase**: Recommendation was significant enough to become an entire phase (not just a task). Specify which phase.

---

## Phases

### Phase 1 — Dist Freshness Check

**Objective**: Add a deterministic `check:dist` script that fails when the committed `dist/` would change after a fresh build, so source/runtime drift cannot be merged unnoticed.

**Tasks**:

- [x] **T1.1**: Design and implement `scripts/check-dist-freshness.mjs`.
  - Files: `scripts/check-dist-freshness.mjs`
  - Evidence:
    - Implemented `scripts/check-dist-freshness.mjs` using Node built-ins only:
      - Resolves repo root and `dist/` path.
      - Builds a fresh copy of `dist/` into a temporary sibling directory inside the repo root (`.kyro-dist-check-xxx`) so source-map `sources` paths match the committed `dist/`.
      - Walks both trees recursively and reports files only in `dist/`, only in the fresh build, or with differing content.
      - Cleans up the temporary directory before exiting.
    - Fresh-pass test:
      ```
      $ node scripts/check-dist-freshness.mjs
      dist/ is fresh: generated output matches current src/.
      ```
    - Stale-detection test (appended `// stale` to `dist/cli.js` plus a backup file):
      ```
      $ node scripts/check-dist-freshness.mjs
      dist/ is stale: generated output differs from current src/.

      Files present in dist/ but missing from fresh build (1):
        - cli.js.bak
      Files with differing content (1):
        - cli.js

      Fix: run npm run build and commit the updated dist/.
      ```
    - Missing-file test (moved `dist/cli/drift.js` aside):
      ```
      $ node scripts/check-dist-freshness.mjs
      dist/ is stale: generated output differs from current src/.

      Files present in dist/ but missing from fresh build (1):
        - cli/drift.js.bak
      Files missing from dist/ but present in fresh build (1):
        - cli/drift.js
      ```
  - Verification: Script exits `0` when `dist/` is fresh and non-zero when `dist/` is stale.

- [x] **T1.2**: Wire `check:dist` into `package.json` and `npm run check`.
  - Files: `package.json`
  - Evidence:
    - Added script entry:
      ```json
      "check:dist": "node scripts/check-dist-freshness.mjs"
      ```
    - Updated `check` script to include it after links:
      ```json
      "check": "npm run typecheck && npm run check:versions && npm run check:links && npm run check:dist"
      ```
    - `npm run check` output:
      ```
      > npm run typecheck && npm run check:versions && npm run check:links && npm run check:dist
      > tsc --noEmit
      > node scripts/check-versions.mjs
      All versions match: 3.4.0
      > node scripts/check-markdown-links.mjs
      All relative links valid (48 files checked)
      > node scripts/check-dist-freshness.mjs
      dist/ is fresh: generated output matches current src/.
      ```
  - Verification: `npm run check:dist` runs successfully and `npm run check` includes it.

- [x] **T1.3**: Verify `check:dist` detects stale and fresh `dist/` states.
  - Files: `dist/**`, `scripts/check-dist-freshness.mjs`
  - Evidence:
    - Stale state test (appended `// stale` to `dist/cli.js`):
      ```
      > node scripts/check-dist-freshness.mjs
      dist/ is stale: generated output differs from current src/.
      Files with differing content (1):
        - cli.js
      Fix: run npm run build and commit the updated dist/.
      EXIT: 1
      ```
    - After `npm run build`:
      ```
      > node scripts/check-dist-freshness.mjs
      dist/ is fresh: generated output matches current src/.
      EXIT: 0
      ```
  - Verification: The gate correctly reflects the current freshness of `dist/`.

### Phase 2 — CI Adapter Fixture Gate

**Objective**: Update the GitHub Actions workflow to run adapter fixture validation after the build, ensuring adapter regressions cannot escape CI.

**Tasks**:

- [x] **T2.1**: Update `.github/workflows/ci.yml` to run `npm run check:adapters` after `npm run build`.
  - Files: `.github/workflows/ci.yml`
  - Evidence:
    - Updated validate step:
      ```yaml
      - name: Validate
        run: |
          npm run check
          npm run build
          npm run check:adapters
          npm run check:tokens
          npm run check:artifacts
          npm run check:artifact-fixtures
          npm pack --dry-run
      ```
  - Verification: The workflow file is syntactically valid and the new step appears after `npm run build`.

- [x] **T2.2**: Validate workflow file syntax.
  - Files: `.github/workflows/ci.yml`
  - Evidence:
    - `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('YAML valid')"` → `YAML valid`
  - Verification: No YAML syntax errors or undefined references.

- [x] **T2.3**: Run the local equivalent of the CI validation matrix and record output.
  - Files: `package.json`, `scripts/check-adapter-fixtures.mjs`
  - Evidence:
    - Local CI matrix passed:
      ```
      npm run check      # typecheck + versions + links + check:dist → dist/ is fresh
      npm run build      # regenerated dist/
      npm run check:adapters → Adapter fixtures passed
      npm run check:tokens → passed (1 pre-existing Codex AGENTS block warn)
      npm run check:artifacts → passed
      npm run check:artifact-fixtures → Artifact integrity fixtures passed
      npm pack --dry-run → kyro-ai-3.4.0.tgz
      ```
  - Verification: All commands pass locally, mirroring the intended CI behavior.

### Phase 3 — Package Dry-Run Ordering

**Objective**: Ensure `npm pack --dry-run` only runs after `check:dist` and `check:adapters` succeed, so releases cannot pack stale or broken runtimes.

**Tasks**:

- [x] **T3.1**: Reorder the CI validate step so `npm pack --dry-run` runs after freshness and adapter checks.
  - Files: `.github/workflows/ci.yml`
  - Evidence:
    - Final validate step order:
      ```yaml
      npm run check        # includes check:dist (freshness gate)
      npm run build
      npm run check:adapters
      npm run check:tokens
      npm run check:artifacts
      npm run check:artifact-fixtures
      npm pack --dry-run   # only after all gates above
      ```
  - Verification: `npm pack --dry-run` is positioned after the reproducibility gates.

- [x] **T3.2**: Review the ordered validate step for logical dependencies and failure behavior.
  - Files: `.github/workflows/ci.yml`
  - Evidence:
    - All commands run in a single GitHub Actions `run` step, so any non-zero exit aborts the step before subsequent commands execute.
    - `npm run check` includes `check:dist`, so stale `dist/` fails before `npm run build`.
    - `npm run check:adapters` runs after `npm run build`, so adapter regressions fail before token/artifact/pack checks.
    - `npm pack --dry-run` is the last command, so it cannot execute if any earlier gate fails.
  - Verification: Early failures (typecheck, stale dist, adapter fixtures) prevent packing.

- [x] **T3.3**: Run the full local validation matrix end-to-end.
  - Files: `package.json`, `dist/**`, `scripts/*`
  - Evidence: See T2.3 evidence; the same ordered matrix was executed end-to-end with all gates passing.
  - Verification: The full matrix passes on the current codebase.

---

## Emergent Phases

<!-- This section starts EMPTY. It is populated during sprint EXECUTION when new work is discovered. -->

---

## Findings Consolidation

| # | Finding | Origin Phase | Impact | Action Taken |
|---|---------|-------------|--------|-------------|
| 1 | `process.exit()` inside a `try` block skips `finally` cleanup, leaking temp directories. | Phase 1 | Left `.kyro-dist-check-*` dirs in the repo on early passes. | Refactored `scripts/check-dist-freshness.mjs` to a single exit point after cleanup. |
| 2 | `index.json`'s `nextTask` must be a verbatim substring of the active sprint Markdown to satisfy artifact validation. | Phase 2 | Initial `nextTask` with plain file/command names caused `npm run check:artifacts` to fail. | Updated `index.json` and sprint summary `nextTask` to match the Markdown task text exactly (including backticks). |
| 3 | `ROADMAP.summary.json` mtime must be no older than `ROADMAP.md` to avoid a stale-summary warning. | Phase 2 | `npm run check:artifacts` warned after editing `ROADMAP.md` in Sprint 1. | Touched `ROADMAP.summary.json` to refresh its mtime. |

---

## Accumulated Technical Debt

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1 | Add deterministic `check:dist` so future source/runtime drift fails before merge. | Strategic audit REP-002 | Sprint 2 | resolved | Sprint 2 |
| 2 | Add `npm run check:adapters` to CI so adapter regressions cannot escape. | Strategic audit REP-003 | Sprint 2 | resolved | Sprint 2 |
| 3 | Document generated artifact and release verification policy after technical gates exist. | Strategic audit REP-005 | Sprint 3 | open | — |

**Status values**: `open` | `in-progress` | `resolved` | `deferred` | `carry-over`

**Rules**:
- Never delete a row — only change status
- New items are appended at the bottom
- Inherited items keep their original numbers
- When resolved, fill "Resolved In" with the sprint number

---

## Definition of Done

- [x] `scripts/check-dist-freshness.mjs` implemented and wired into `package.json`.
- [x] `npm run check:dist` fails on stale `dist/` and passes after `npm run build`.
- [x] `npm run check` includes `check:dist`.
- [x] `.github/workflows/ci.yml` runs `npm run check:adapters` after `npm run build`.
- [x] `.github/workflows/ci.yml` runs `npm pack --dry-run` after `check:dist` and `check:adapters`.
- [x] Local validation matrix (check → build → check:dist → check:adapters → check:tokens → check:artifacts → check:artifact-fixtures → pack dry-run) passes.
- [x] No source, docs, or release policy changes beyond CI/check gates.
- [x] Debt table updated with Sprint 2 items marked `resolved`.
- [x] Retro section filled before close.
- [x] Recommendations for Sprint 3 documented before close.
- [x] Re-entry prompts and summary JSON refreshed at close.

---

## Retro

### What Went Well

- The `check:dist` script worked on the first design: build fresh output to a repo-root temp directory, walk both trees, and compare bytes. Source-map path parity was preserved by keeping the temp dir at the same depth as `dist/`.
- All three phases stayed tightly scoped to check/CI gates; no source logic or documentation policy crept in.
- The local CI matrix mirrored the GitHub Actions step exactly, giving high confidence the workflow will pass in CI.

### What Didn't Go Well

- Artifact validation (`npm run check:artifacts`) failed initially because `index.json`'s `nextTask` included a task ID and plain text, while the sprint Markdown used bold task IDs and backtick-wrapped file/command names. The artifact doctor requires `nextTask` to be a literal substring of the sprint Markdown.
- `dist/` was rebuilt during the local matrix test, creating a large mechanical diff that is hard to review through git because `dist/` is `.gitignore`d.

### Surprises / Unexpected Findings

- The `check:dist` script's first version leaked temporary directories because `process.exit()` inside a `try` block skipped the `finally` cleanup. Refactoring to a single exit point at the end fixed it.
- `npm run check:artifacts` validates that `index.json`'s `nextTask` is present verbatim in the active sprint Markdown — a cross-file consistency check we did not anticipate when writing the sprint plan.

### New Technical Debt Detected

- None. Debt items #1 and #2 were resolved; debt item #3 remains open for Sprint 3.

---

## Recommendations for Sprint 3

1. **Document generated artifact policy** (REP-005): Write a maintainer-facing guide explaining when `dist/` must be committed, how `npm run check:dist` proves freshness, and the CI gate ordering.
2. **Add release checklist**: Create a short `docs/release-checklist.md` that references the actual commands (`npm run build`, `npm run check:dist`, `npm run check:adapters`, `npm pack --dry-run`) verified in Sprints 1 and 2.
3. **Prepare release notes for 3.4.x**: Summarize the runtime parity fix (Sprint 1) and the new reproducibility gates (Sprint 2) for the next release.
4. **Consider a `prepublishOnly` safety net**: Evaluate whether `npm run check:dist` and `npm run check:adapters` should be added to `prepublishOnly` so local publishes cannot skip gates.
