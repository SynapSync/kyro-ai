---
title: "Sprint 1 — Context-pack CLI Foundation"
date: "2026-06-20"
updated: "2026-06-20"
scope: "01-token-cost-optimization"
type: "sprint-plan"
status: "completed"
version: "1.0"
sprint: 1
progress: 100
previous_doc: null
next_doc: "[[SPRINT-002-task-specific-packs-and-budget-fixtures]]"
parent_doc: "[[ROADMAP]]"
agents:
  - "opencode"
tags:
  - "01-token-cost-optimization"
  - "sprint-plan"
  - "sprint-1"
  - "context-pack"
  - "token-cost"
changelog:
  - version: "1.0"
    date: "2026-06-20"
    changes: ["Sprint generated from token-cost-optimization roadmap"]
related:
  - "[[ROADMAP]]"
  - "[[01-context-pack-command-foundation]]"
---

# Sprint 1 — Context-pack CLI Foundation

> Source: `findings/01-context-pack-command-foundation.md`
> Previous Sprint: None
> Version Target: 3.4.x
> Type: feature
> Carry-over: 0 items from previous sprint
> Execution Date: 2026-06-20
> Executed By: opencode (prep), cursor (implementation)

---

## Sprint Objective

Add a deterministic `kyro context-pack --kyro-scope <scope>` command that emits a bounded, summary-first context package for an existing Kyro scope. The command must read structured routing artifacts (`state.json`, `index.json`, `ROADMAP.summary.json`, `rules.index.json`) instead of requiring agents to manually choose files, and must support both human-readable text and `--json` output with warnings and estimated token totals.

This sprint intentionally covers only the base scope/status pack. Task-specific packs (`--task <id>`), budget regression fixtures, and model/budget routing are deferred to Sprints 2 and 3 so reviewers can validate the public CLI contract independently.

---

## Disposition of Previous Sprint Recommendations

Sprint 1 has no previous sprint. No recommendation disposition is required.

---

## Phases

### Phase 1 — CLI Contract

**Objective**: Route the new command through the CLI, reuse existing option parsing, and load scope artifacts through the established artifact helpers.

**Tasks**:

- [x] **T1.1**: Add `context-pack` command dispatch in `runCli`.
  - Files: `src/cli/app.ts`
  - Evidence: `context-pack` branch parses options and calls `contextPack(options)` before the generic command switch.
  - Verification: `node dist/cli.js context-pack --help` → `Usage: kyro context-pack [--kyro-scope <scope>] [--json]`

- [x] **T1.2**: Add command help and top-level help entry for `context-pack`.
  - Files: `src/cli/help.ts`
  - Evidence: Top-level help lists `kyro context-pack`; command help documents `--kyro-scope` and `--json`; examples include context-pack usage.
  - Verification: `node dist/cli.js --help` and `node dist/cli.js context-pack --help` show the new command.

- [x] **T1.3**: Create `context-pack` command module with scope resolution and artifact reads.
  - Files: `src/cli/commands/context-pack.ts`
  - Evidence:
    - Resolves scope from `--kyro-scope` or `activeScope` in `kyro.json`.
    - Reads `state.json`, `index.json`, `ROADMAP.summary.json`, and `rules.index.json` via `readJsonSafely` and schema validators.
    - Unknown scope throws `Scope not found: <scope>`.
  - Verification: `node dist/cli.js context-pack --kyro-scope 01-token-cost-optimization` exits `0`.

### Phase 2 — Output Contract

**Objective**: Emit a summary-first context package in text and JSON with warnings, artifact paths, and estimated token totals.

**Tasks**:

- [x] **T2.1**: Define typed context-pack output shape.
  - Files: `src/cli/types.ts`, `src/cli/commands/context-pack.ts`
  - Evidence: `ContextPackOutput`, `ContextPackRuleSummary`, and `ContextPackArtifactPaths` exported from `types.ts`.
  - Verification: `npm run typecheck` passes.

- [x] **T2.2**: Implement summary-first text output.
  - Files: `src/cli/commands/context-pack.ts`
  - Evidence: Text mode prints Scope Status, Routing Summary, Artifact Paths, Rules, Warnings, and `Estimated tokens: ~403` for the active scope without loading `ROADMAP.md`.
  - Verification: Output is bounded; no Markdown body emitted.

- [x] **T2.3**: Implement `--json` machine-readable output.
  - Files: `src/cli/commands/context-pack.ts`
  - Evidence: `--json` prints a single `ContextPackOutput` object with `estimatedTokens` and `warnings`.
  - Verification: `node dist/cli.js context-pack --kyro-scope 01-token-cost-optimization --json` parses as valid JSON.

- [x] **T2.4**: Handle missing-scope and missing-summary warnings.
  - Files: `src/cli/commands/context-pack.ts`, `scripts/check-context-pack-fixtures.mjs`
  - Evidence: Unknown scope exits non-zero; missing `ROADMAP.summary.json` adds warning while retaining `index.json` roadmap summary.
  - Verification: `npm run check:context-pack` covers valid, missing-summary, and unknown-scope cases.

### Phase 3 — Validation and Documentation

**Objective**: Prove the command with fixtures/golden output and document the new public surface.

**Tasks**:

- [x] **T3.1**: Add context-pack fixture checker with golden output for a valid scope.
  - Files: `scripts/check-context-pack-fixtures.mjs`, `fixtures/context-pack/valid-demo.json`
  - Evidence: Golden snapshot at `fixtures/context-pack/valid-demo.json`; fixture normalizes `estimatedTokens` for stable comparison.
  - Verification: `npm run check:context-pack` → `Context-pack fixtures passed`

- [x] **T3.2**: Add regression cases for missing scope and missing-summary warnings.
  - Files: `scripts/check-context-pack-fixtures.mjs`
  - Evidence: Uses `fixtures/artifact-integrity/valid`, `missing-summary`, and unknown-scope failure path.
  - Verification: Fixture script exits `0` on current output; would fail on drift.

- [x] **T3.3**: Update CLI and context-management docs.
  - Files: `docs/cli.md`, `docs/context-management.md`, `docs/commands-reference.md`
  - Evidence: Added Context Pack sections and release gate entry for `check:context-pack`.
  - Verification: `npm run check:links` → `All relative links valid (54 files checked)`

- [x] **T3.4**: Rebuild `dist/` and run package checks.
  - Files: `dist/**`, `package.json`
  - Evidence:
    - `npm run build` → success
    - `npm run check` → success
    - `npm run check:context-pack` → success
    - `npm run check:tokens` → success (pre-existing AGENTS block warn only)
    - `node dist/cli.js doctor --artifacts --kyro-scope 01-token-cost-optimization` → all PASS
  - Verification: All checks exit `0`; `dist/cli/commands/context-pack.js` present.

---

## Emergent Phases

<!-- Populated during execution when new work is discovered. -->

---

## Findings Consolidation

<!-- Filled during sprint CLOSE. -->

| # | Finding | Origin Phase | Impact | Action Taken |
|---|---------|-------------|--------|-------------|
| 1 | Fixture checker must pass `--json` explicitly | Phase 3 | low | Fixed `check-context-pack-fixtures.mjs` to request JSON output |
| 2 | Rules load globally from workspace `rules.index.json` | Phase 2 | medium | Documented behavior; all 12 rules included in scope pack when index exists |

---

## Accumulated Technical Debt

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| — | No inherited debt | — | — | — | — |

**Status values**: `open` | `in-progress` | `resolved` | `deferred` | `carry-over`

---

## Definition of Done

- [x] All phase tasks completed or explicitly skipped with justification
- [x] All emergent phase tasks completed
- [x] `kyro context-pack --kyro-scope <scope>` emits bounded summary-first text and JSON output
- [x] Context-pack fixture/golden tests pass
- [x] Accumulated debt table updated (new items added, resolved items marked)
- [x] `npm run check` passes after `dist/` rebuild
- [x] Retro section filled
- [x] Recommendations for next sprint documented
- [x] Re-entry prompts updated to reflect current state

---

## Retro

<!-- Filled when the sprint is CLOSED. -->

### What Went Well

- Reused existing artifact helpers (`readJsonSafely`, schema validators, `listScopeNames`) instead of duplicating doctor logic.
- Fixture checker composes with existing `fixtures/artifact-integrity` trees for missing-summary regression.
- Token budgets remained within limits after adding the new command surface.

### What Didn't Go Well

- Initial fixture script omitted `--json`, causing a false failure before correction.

### Surprises / Unexpected Findings

- Active workspace scope pack includes all 12 global rules (~403 estimated tokens), which is acceptable now but may need filtering in Sprint 2.

### New Technical Debt Detected

- None blocking Sprint 2.

---

## Recommendations for Sprint 2

1. Add `--task <id>` resolution from sprint summary/index and filter rules by `affectedModes` tags.
2. Add context-pack budget regression fixtures with explicit token ceilings per scope/task pack.
3. Include `check:context-pack` in release checklist and CI once Sprint 2 fixtures stabilize.