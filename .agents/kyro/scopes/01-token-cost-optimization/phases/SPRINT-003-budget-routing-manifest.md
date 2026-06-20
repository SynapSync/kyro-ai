---
title: "Sprint 3 — Budget Routing Manifest"
date: "2026-06-20"
updated: "2026-06-20"
scope: "01-token-cost-optimization"
type: "sprint-plan"
status: "completed"
version: "1.1"
sprint: 3
progress: 100
previous_doc: "[[SPRINT-002-task-specific-packs-and-budget-fixtures]]"
next_doc: null
parent_doc: "[[ROADMAP]]"
agents:
  - "opencode"
tags:
  - "01-token-cost-optimization"
  - "sprint-plan"
  - "sprint-3"
  - "budget-routing"
  - "context-pack"
changelog:
  - version: "1.0"
    date: "2026-06-20"
    changes: ["Sprint generated from token-cost-optimization roadmap after Sprint 2 close"]
related:
  - "[[ROADMAP]]"
  - "[[04-model-budget-routing-manifest]]"
---

# Sprint 3 — Budget Routing Manifest

> Source: `findings/04-model-budget-routing-manifest.md`
> Previous Sprint: `phases/SPRINT-002-task-specific-packs-and-budget-fixtures.md`
> Version Target: 3.4.x
> Type: feature
> Carry-over: 0 items from previous sprint
> Execution Date: 2026-06-20
> Executed By: kyro-forge

---

## Sprint Objective

Encode provider-neutral budget classes (`brief`, `execute`, `review`, `close`) in Kyro config and TypeScript types, select the appropriate class for each context-pack, and expose budget class plus reasoning guidance in context-pack output and documentation. The manifest must not reference provider-specific model IDs.

This is the final sprint in the `01-token-cost-optimization` roadmap. After close, the scope should be ready for `wrap_up`.

---

## Disposition of Previous Sprint Recommendations

| # | Recommendation | Action | Where | Justification |
|---|---------------|--------|-------|---------------|
| 1 | Add provider-neutral budget classes to config/types and surface selected class in context-pack output | Incorporated | Phase 1 (T1.1–T1.4), Phase 2 (T2.1–T2.3) | Core Sprint 3 objective from finding 04. |
| 2 | Normalize `index.nextTask` to task ids or map prose nextTask to sprint Markdown tasks | Deferred | Post-scope / future enhancement | Budget manifest sprint does not require nextTask normalization to prove provider-neutral routing. |
| 3 | Add `check:context-pack` to CI workflow YAML alongside artifact fixtures | Incorporated | Phase 3, T3.2 | Completes release gate started in Sprint 2 docs. |
| 4 | Decide release version bump (3.4.3 vs 3.5.0) when packaging context-pack task mode | Incorporated | Phase 3, T3.3 | Final packaging decision belongs with this sprint's release validation. |

---

## Phases

### Phase 1 — Manifest Contract

**Objective**: Define budget classes in config/types with token budgets and reasoning guidance, without provider-specific model names.

**Tasks**:

- [x] **T1.1**: Add `budgetClasses` manifest to `config.json`.
  - Files: `config.json`
  - Evidence: Manifest defines `brief`, `execute`, `review`, and `close` with `maxContextTokens`, `reasoningTier` (e.g. `light`, `standard`, `deep`), and `guidance` strings. No provider model IDs.
  - Verification: JSON parses; classes cover scope status, task execution, review, and closeout paths.

- [x] **T1.2**: Add TypeScript types and manifest loader.
  - Files: `src/cli/types.ts`, new `src/cli/budget-manifest.ts` (or `src/cli/artifacts/budget-manifest.ts`)
  - Evidence: Exported `BudgetClass`, `BudgetManifest`, and `loadBudgetManifest()` read from package `config.json`.
  - Verification: `npm run typecheck` passes; loader returns all four classes.

- [x] **T1.3**: Implement budget class selection from pack context.
  - Files: `src/cli/budget-manifest.ts`, `src/cli/commands/context-pack.ts`
  - Evidence: Selection rules:
    - scope pack + `nextAction: plan_sprint|status` → `brief`
    - task pack / `execute_task` → `execute`
    - explicit review paths (future hook or `review_task` nextAction) → `review`
    - `close_sprint|wrap_up` → `close`
  - Verification: Unit-level tests or fixture expectations document mapping for demo and active scope fixtures.

- [x] **T1.4**: Add manifest schema/fixture validation script.
  - Files: `scripts/check-budget-manifest.mjs`, `fixtures/context-pack/budget-manifest.json` (expected shape golden)
  - Evidence: Fails when a class is missing, guidance is empty, or any value contains provider model name patterns (e.g. `gpt-`, `claude-`, `gemini-`).
  - Verification: `npm run check:budget-manifest` exits `0` on valid manifest.

### Phase 2 — Context Integration

**Objective**: Include selected budget class and guidance in context-pack output and fixtures.

**Tasks**:

- [x] **T2.1**: Extend `ContextPackOutput` with budget routing fields.
  - Files: `src/cli/types.ts`, `src/cli/commands/context-pack.ts`
  - Evidence: Output adds `budgetClass`, `reasoningTier`, `budgetGuidance`, and `maxContextTokens` from manifest.
  - Verification: TypeScript compiles; JSON output includes new fields in scope and task modes.

- [x] **T2.2**: Render budget class in text and JSON output.
  - Files: `src/cli/commands/context-pack.ts`
  - Evidence: Text mode prints `Budget Class` section; JSON includes routing fields after `estimatedTokens`.
  - Verification: `kyro context-pack --kyro-scope 01-token-cost-optimization --json` shows `budgetClass: "execute"` during active sprint execution.

- [x] **T2.3**: Update context-pack fixtures with expected budget classes.
  - Files: `scripts/check-context-pack-fixtures.mjs`, `fixtures/context-pack/valid-demo.json`, `fixtures/context-pack/task-demo.json`
  - Evidence: Golden snapshots include `budgetClass` and `reasoningTier`; scope demo expects `brief` or `execute` per fixture state.
  - Verification: `npm run check:context-pack` passes with updated goldens.

- [x] **T2.4**: Wire `check:budget-manifest` into `npm run check` (optional gate).
  - Files: `package.json`
  - Evidence: `check` script includes budget manifest validation when gate is enabled.
  - Verification: `npm run check` runs manifest validation without breaking existing gates.

### Phase 3 — Documentation, CI, and Release

**Objective**: Document budget-class tradeoffs, add CI gate, decide version bump, and validate the full scope proof.

**Tasks**:

- [x] **T3.1**: Update cost and context documentation.
  - Files: `docs/cost-model.md`, `docs/context-management.md`, `docs/cli.md`
  - Evidence: Docs explain budget classes, selection rules, reasoning tiers, and quality boundaries without provider model names.
  - Verification: `npm run check:links` passes.

- [x] **T3.2**: Add `check:context-pack` to CI workflow.
  - Files: `.github/workflows/ci.yml`, `docs/release-checklist.md`
  - Evidence: CI `validate` job runs `npm run check:context-pack` after artifact fixtures; release checklist matches CI ordering.
  - Verification: Workflow YAML syntax valid; local `npm run check:context-pack` still passes.

- [x] **T3.3**: Decide and apply release version bump.
  - Files: `package.json`, `.claude-plugin/plugin.json`, `WORKFLOW.yaml`, `.claude-plugin/marketplace.json`
  - Evidence: Version bumped to `3.4.3` (patch — new CLI flags and manifest, no breaking API) with synced metadata per Agents.md checklist.
  - Verification: `npm run check:versions` passes.

- [x] **T3.4**: Rebuild `dist/` and run full release gate sequence.
  - Files: `dist/**`
  - Evidence:
    - `npm run build`
    - `npm run check`
    - `npm run check:context-pack`
    - `npm run check:tokens`
    - `node dist/cli.js doctor --artifacts --kyro-scope 01-token-cost-optimization`
  - Verification: All commands exit `0`.

- [x] **T3.5**: Prepare scope for wrap-up.
  - Files: `.agents/kyro/scopes/01-token-cost-optimization/state.json`, `ROADMAP.summary.json`, `RE-ENTRY-PROMPTS.md`
  - Evidence: After sprint close, roadmap shows 3/3 sprints completed; re-entry prompts point to `wrap_up` for final scope closure.
  - Verification: `doctor --artifacts` passes; no open debt rows.

---

## Emergent Phases

<!-- Populated during execution when new work is discovered. -->

---

## Findings Consolidation

| # | Finding | Origin Phase | Impact | Action Taken |
|---|---------|-------------|--------|-------------|
| 1 | Scope packs during `execute_task` map to `execute`, not `brief` | Phase 1 | low | Documented selection rules; fixture expects `execute` when nextAction is `execute_task` |
| 2 | Budget fields add modest token overhead to pack estimates | Phase 2 | low | Kept regression ceilings unchanged; estimates remain well under fixture budgets |
| 3 | `check:budget-manifest` belongs in both `npm run check` and CI | Phase 3 | medium | Wired into package check script and `.github/workflows/ci.yml` |

---

## Accumulated Technical Debt

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| D1 | Map prose `index.nextTask` values to sprint task ids for `--task` fallback | Sprint 2 retro | post-scope | deferred | — |

**Status values**: `open` | `in-progress` | `resolved` | `deferred` | `carry-over`

---

## Definition of Done

- [x] All phase tasks completed or explicitly skipped with justification
- [x] Budget classes encoded in config/types without provider-specific model names
- [x] Context-pack output includes `budgetClass` and reasoning guidance
- [x] Manifest and context-pack fixtures pass
- [x] CI and release checklist include `check:context-pack`
- [x] Version metadata synced (if bump applied)
- [x] Retro section filled
- [x] Scope ready for `wrap_up` after sprint close
- [x] Re-entry prompts updated to reflect completed roadmap

---

## Retro

### What Went Well

- Budget manifest loader and selection logic stayed provider-neutral with a small, testable surface.
- Fixture gates compose cleanly: `check:budget-manifest` validates config shape; `check:context-pack` validates runtime output.
- Version bump to 3.4.3 synced across package, plugin, and WORKFLOW metadata in one pass.

### What Didn't Go Well

- Sprint execution was interrupted once; remaining tasks were completed in a follow-up forge session.

### Surprises / Unexpected Findings

- `execute_task` nextAction selects `execute` even for scope packs — this is intentional but differs from a naive "scope = brief" assumption.

### New Technical Debt Detected

- None blocking scope wrap-up. D1 (prose nextTask mapping) remains deferred.

---

## Recommendations for Post-Scope

1. Run `kyro-wrap-up` to finalize scope handoff and session closure for `01-token-cost-optimization`.
2. Normalize `index.nextTask` to task ids during sprint execution so bare `--task` works without prose fallbacks.
3. Consider exposing budget class hints in `kyro doctor --tokens` output for adapter agents that do not call context-pack directly.