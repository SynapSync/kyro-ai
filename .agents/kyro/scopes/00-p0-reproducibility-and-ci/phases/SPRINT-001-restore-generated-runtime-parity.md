---
title: "Sprint 1 — Restore Generated Runtime Parity"
date: "2026-06-19"
updated: "2026-06-19"
scope: "00-p0-reproducibility-and-ci"
type: "sprint-plan"
status: "active"
version: "1.0"
sprint: 1
progress: 0
previous_doc: null
next_doc: "[[SPRINT-002-enforce-freshness-and-adapter-ci-gates]]"
parent_doc: "[[ROADMAP]]"
agents:
  - "codex"
tags:
  - "00-p0-reproducibility-and-ci"
  - "sprint-plan"
  - "sprint-1"
  - "reproducibility"
  - "dist"
changelog:
  - version: "1.0"
    date: "2026-06-19"
    changes: ["Sprint generated from P0 reproducibility roadmap"]
related:
  - "[[ROADMAP]]"
  - "[[01-stale-generated-runtime]]"
---

# Sprint 1 — Restore Generated Runtime Parity

> Source: `findings/01-stale-generated-runtime.md`
> Previous Sprint: None
> Version Target: 3.4.x
> Type: bugfix
> Carry-over: 0 items from previous sprint
> Execution Date: TBD
> Executed By: TBD

---

## Sprint Objective

Restore trust between Kyro's TypeScript source and its generated JavaScript runtime by rebuilding `dist/` from current `src/`, verifying the generated CLI exposes the expected adapter behavior, and recording focused evidence before any CI or documentation policy work begins.

This sprint intentionally covers only REP-001. CI enforcement, `check:dist`, and generated artifact policy are deferred to later sprints so reviewers can inspect the mechanical runtime parity change without unrelated logic or documentation noise.

---

## Disposition of Previous Sprint Recommendations

Sprint 1 has no previous sprint. No recommendation disposition is required.

---

## Phases

### Phase 1 — Runtime Drift Verification

**Objective**: Prove the current source/runtime mismatch before rebuilding so the fix has auditable before/after evidence.

**Tasks**:

- [x] **T1.1**: Capture current source support for adapter inventory and related CLI behavior.
  - Files: `src/cli/options.ts`, `src/cli/commands/doctor.ts`, `src/cli/commands/detect.ts`, `src/cli/commands/preflight.ts`
  - Evidence:
    - `src/cli/options.ts:13,31-32` — parses `--adapters` boolean into `CliOptions.adapters`.
    - `src/cli/commands/doctor.ts:12-13,26,38,142-165` — `doctor()` accepts `adapters`, and `checkAdapterInventory()` iterates `ADAPTERS` to report per-adapter status, managed files/blocks, capabilities, and strategies.
    - `src/cli/commands/detect.ts:2,6-40` — `detect()` iterates selected adapters via `ADAPTERS`/`getAdapterDefinition`, runs `adapter.detect()`, and prints installed/config/binary/capabilities/system-prompt/MCP strategy.
    - `src/cli/commands/preflight.ts:6-52` — `runAdapterPreflight()` runs detection, builds managed files/blocks, and asserts no `planned` adapter is installable.
    - Grep context confirms wiring in `src/cli/app.ts:2,45-46` (`detect` command dispatch) and help text in `src/cli/help.ts:13,26,37,48,50`.
  - Verification: Source references are listed in task evidence with file paths and line or grep context.

- [x] **T1.2**: Capture current generated runtime gap before rebuild.
  - Files: `dist/cli/options.js`, `dist/cli/commands/*`, `dist/cli/adapters/*`
  - Evidence:
    - `dist/cli/app.js` does not import or dispatch `detect` (only `doctor`, `install`, `repair`, `scope`, `sync`, `tui`, `uninstall`).
    - `dist/cli/options.js` does not parse `--adapters`; the returned object omits the `adapters` field present in `src/cli/options.ts`.
    - `dist/cli/commands/doctor.js` calls `runDoctorChecks(includeTokenAudit, includeArtifactAudit, kyroScope)` — it is missing the `includeAdapterInventory` parameter and the `checkAdapterInventory()` function exists only in source.
    - `dist/cli/commands/detect.js` and `dist/cli/commands/preflight.js` are absent from the generated runtime.
    - `node dist/cli.js doctor --adapters` → `ERROR: Unknown option: --adapters`.
    - `node dist/cli.js detect` → `ERROR: Unknown command: detect. Run kyro --help.`
    - `node dist/cli.js doctor` passes core checks, confirming the gap is adapter-support drift rather than total runtime failure.
  - Verification: The sprint evidence records whether current `dist/` is stale and which generated files are missing or outdated.

### Phase 2 — Dist Rebuild

**Objective**: Regenerate the JavaScript runtime from current TypeScript source and inspect the generated output as a mechanical artifact update.

**Tasks**:

- [x] **T2.1**: Run the project build to regenerate `dist/`.
  - Files: `dist/**`
  - Evidence:
    - `npm run build` output:
      ```
      > npm run clean && tsc && npm run build:chmod
      > rm -rf dist
      > node scripts/make-cli-executable.mjs
      Made dist/cli.js executable
      ```
    - `node dist/cli.js --version` → `3.4.0`.
  - Verification: Build exits successfully and `dist/cli.js` remains executable.

- [x] **T2.2**: Inspect generated runtime changes for expected source parity.
  - Files: `dist/**`
  - Evidence:
    - `git diff --stat dist` returns empty because `dist/` is listed in `.gitignore`.
    - Regenerated file count: 144 files under `dist/` (36 `.js`, 36 `.d.ts`, 72 `.map`).
    - Newly present generated modules matching source:
      - `dist/cli/commands/detect.js` / `.d.ts` (was absent before rebuild)
      - `dist/cli/commands/preflight.js` / `.d.ts` (was absent before rebuild)
      - `dist/cli/drift.js` / `.d.ts` (was absent before rebuild)
      - `dist/cli/adapters/detection.js` / `.d.ts` (was absent before rebuild)
      - `dist/cli/injectors/json-merge.js` / `managed-block.js` (was absent before rebuild)
      - `dist/cli/pipeline/orchestrator.js` / `operation-steps.js` / `types.js` (was absent before rebuild)
    - `dist/cli/options.js` now contains `--adapters` parsing and returns the `adapters` field.
    - `dist/cli/app.js` now imports and dispatches `detect`.
    - `dist/cli/commands/doctor.js` now accepts `includeAdapterInventory` and calls `checkAdapterInventory()`.
  - Verification: Generated files correspond to existing `src/` modules and no unrelated source files are changed by this task.

### Phase 3 — Runtime Regression Evidence

**Objective**: Prove the regenerated runtime now supports the expected adapter behavior before closing the sprint.

**Tasks**:

- [x] **T3.1**: Verify the generated CLI supports adapter inventory.
  - Files: `dist/cli/options.js`, `dist/cli/commands/doctor.js`
  - Evidence:
    - `node dist/cli.js doctor --adapters` exits `0` and reports adapter inventory:
      - `standard` — implemented; managedFiles=3; nativePaths=2; capabilities=command-skills
      - `opencode` — implemented; managedFiles=6; managedBlocks=1; nativePaths=6; capabilities=command-skills,filesystem-detect,system-prompt,slash-commands
      - `codex` — implemented; managedFiles=3; managedBlocks=1; nativePaths=4; capabilities=command-skills,workspace-agents-block,filesystem-detect,system-prompt,mcp
      - `claude`, `cursor` — planned (warn)
    - No `Unknown option: --adapters` error after rebuild.
  - Verification: Command exits successfully and reports adapter inventory instead of `Unknown option: --adapters`.

- [x] **T3.2**: Run adapter fixture validation against regenerated `dist/`.
  - Files: `scripts/check-adapter-fixtures.mjs`, `dist/**`
  - Evidence:
    - `npm run check:adapters` output:
      ```
      > node scripts/check-adapter-fixtures.mjs
      Adapter fixtures passed
      ```
  - Verification: Adapter fixtures pass.

- [x] **T3.3**: Run focused package checks that prove the rebuilt runtime is safe to carry forward.
  - Files: `package.json`, `dist/**`, `.agents/kyro/scopes/00-p0-reproducibility-and-ci/phases/SPRINT-001-restore-generated-runtime-parity.md`
  - Evidence:
    - `npm run check` passes:
      ```
      > npm run typecheck && npm run check:versions && npm run check:links
      > tsc --noEmit
      > node scripts/check-versions.mjs
      All versions match: 3.4.0
      > node scripts/check-markdown-links.mjs
      All relative links valid (48 files checked)
      ```
    - `npm run check:tokens` passes with one pre-existing warning:
      - `[WARN] token budget: AGENTS block: Kyro managed block not found` (remedy: install/sync codex adapter).
      - This warning is pre-existing and unrelated to REP-001 runtime parity; it reflects that this workspace has no Codex AGENTS.md managed block.
    - `npm pack --dry-run` succeeds and produces `kyro-ai-3.4.0.tgz`.
  - Verification: Checks pass or any warning is classified as pre-existing and non-blocking for REP-001.

---

## Emergent Phases

<!-- This section starts EMPTY. It is populated during sprint EXECUTION when new work is discovered. -->

---

## Findings Consolidation

| # | Finding | Origin Phase | Impact | Action Taken |
|---|---------|-------------|--------|-------------|
| 1 | Current `dist/` was missing adapter-related source features: `--adapters` option, `detect` command, `preflight` command, and adapter inventory in `doctor`. | Phase 1 | Generated runtime could not report adapter inventory or run adapter detection, masking the true adapter support implemented in `src/`. | Rebuilt `dist/` from current `src/`; verified `doctor --adapters`, `detect`, and `check:adapters` now pass. |
| 2 | `dist/` is tracked by `.gitignore`, so `git diff --stat dist` cannot surface mechanical drift during review. | Phase 2 | Reviewers must rely on file listings and command outputs rather than git diff stats for generated artifacts. | Documented file count and targeted module lists in sprint evidence; deferred deterministic `check:dist` gate to Sprint 2 (debt #1). |
| 3 | `npm run check:tokens` reports a pre-existing warning for the Codex AGENTS managed block because the development workspace has no Codex installation. | Phase 3 | False-positive token audit warning unrelated to runtime parity; could confuse reviewers if not classified. | Classified as pre-existing and non-blocking for REP-001 in T3.3 evidence. |

---

## Accumulated Technical Debt

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1 | Add deterministic `check:dist` so future source/runtime drift fails before merge. | Strategic audit REP-002 | Sprint 2 | open | — |
| 2 | Add `npm run check:adapters` to CI so adapter regressions cannot escape. | Strategic audit REP-003 | Sprint 2 | open | — |
| 3 | Document generated artifact and release verification policy after technical gates exist. | Strategic audit REP-005 | Sprint 3 | open | — |

**Status values**: `open` | `in-progress` | `resolved` | `deferred` | `carry-over`

---

## Definition of Done

- [x] Current source/runtime drift evidence captured before rebuild.
- [x] `npm run build` completed successfully.
- [x] Generated `dist/` changes inspected and confirmed as source-derived.
- [x] `node dist/cli.js doctor --adapters` succeeds after rebuild.
- [x] `npm run check:adapters` succeeds after rebuild.
- [x] Focused package checks are recorded: `npm run check`, `npm run check:tokens`, and `npm pack --dry-run`.
- [x] No source, CI, or docs policy changes are introduced in this sprint unless required to unblock generated runtime parity.
- [x] Accumulated debt table remains intact for Sprint 2 and Sprint 3.
- [x] Retro section filled before close.
- [x] Recommendations for Sprint 2 documented before close.
- [x] Re-entry prompts and summary JSON refreshed at close.

---

## Retro

### What Went Well

- Source/runtime gap was sharply bounded: only adapter-related generated files were stale; core `doctor` checks continued to pass.
- `npm run build` regenerated the full runtime in a single pass, and `doctor --adapters`, `detect`, and `check:adapters` all passed immediately after rebuild.
- The pre-close package checks (`npm run check`, `npm run check:tokens`, `npm pack --dry-run`) surfaced no new issues, confirming the change is safe to carry forward.

### What Didn't Go Well

- `dist/` is `.gitignore`d, so mechanical generated-file changes cannot be reviewed through normal `git diff --stat dist`. The sprint evidence had to rely on file listings and command outputs instead.
- The first attempt at listing `dist/cli/commands` with glob tooling failed because the tool respects `.gitignore`; we had to fall back to shell listing.

### Surprises / Unexpected Findings

- The generated runtime was missing not just `--adapters` parsing but the entire `detect` and `preflight` commands, plus the `drift`, `injectors`, and `pipeline` modules. The gap was broader than a single stale option.
- The Codex AGENTS block warning from `check:tokens` is pre-existing in this workspace and would be resolved by installing/syncing the Codex adapter, not by this sprint.

### New Technical Debt Detected

- None beyond the three items already carried for Sprints 2 and 3 (deterministic `check:dist`, CI adapter fixture gate, generated artifact/release policy docs).

---

## Recommendations for Sprint 2

1. **Add deterministic `check:dist` gate** (REP-002): Implement a script that compares `src/` timestamps/contents against `dist/` and fails if `dist/` is stale. Wire it into `npm run check` so local and CI runs catch drift before merge.
2. **Add adapter fixture check to CI** (REP-003): Update the GitHub Actions workflow to run `npm run check:adapters` after `npm run build`, ensuring adapter regressions cannot escape.
3. **Order package dry-run after freshness and adapter gates** (REP-004): Ensure `npm pack --dry-run` (or equivalent release step) runs only after `check:dist` and `check:adapters` succeed, so releases cannot pack stale or broken runtimes.
4. **Prepare release notes placeholder** for the regenerated `dist/` so Sprint 3 policy docs can reference the exact runtime parity fix.
