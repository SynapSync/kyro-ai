---
title: "Sprint 2 — Task-specific Packs and Budget Fixtures"
date: "2026-06-20"
updated: "2026-06-20"
scope: "01-token-cost-optimization"
type: "sprint-plan"
status: "completed"
version: "1.0"
sprint: 2
progress: 100
previous_doc: "[[SPRINT-001-context-pack-cli-foundation]]"
next_doc: "[[SPRINT-003-budget-routing-manifest]]"
parent_doc: "[[ROADMAP]]"
agents:
  - "opencode"
tags:
  - "01-token-cost-optimization"
  - "sprint-plan"
  - "sprint-2"
  - "context-pack"
  - "task-pack"
  - "token-budget"
changelog:
  - version: "1.0"
    date: "2026-06-20"
    changes: ["Sprint generated from token-cost-optimization roadmap after Sprint 1 close"]
related:
  - "[[ROADMAP]]"
  - "[[02-task-specific-context-selection]]"
  - "[[03-context-pack-token-regression-fixtures]]"
---

# Sprint 2 — Task-specific Packs and Budget Fixtures

> Source: `findings/02-task-specific-context-selection.md`, `findings/03-context-pack-token-regression-fixtures.md`
> Previous Sprint: `phases/SPRINT-001-context-pack-cli-foundation.md`
> Version Target: 3.4.x
> Type: feature
> Carry-over: 0 items from previous sprint
> Execution Date: 2026-06-20
> Executed By: cursor

---

## Sprint Objective

Extend `kyro context-pack` with `--task <id>` so agents receive only task-relevant context: active task description, likely files, verification criteria, matching rules, and compact evidence paths. Add budget regression fixtures that lock scope-pack and task-pack token ceilings and fail when output grows without an explicit fixture update.

This sprint builds on the Sprint 1 scope/status pack. Provider-neutral budget/model routing remains deferred to Sprint 3.

---

## Disposition of Previous Sprint Recommendations

| # | Recommendation | Action | Where | Justification |
|---|---------------|--------|-------|---------------|
| 1 | Add `--task <id>` resolution from sprint summary/index and filter rules by `affectedModes` tags | Incorporated | Phase 1 (T1.1–T1.4), Phase 2 (T2.1–T2.3) | Core Sprint 2 objective from findings 02. |
| 2 | Add context-pack budget regression fixtures with explicit token ceilings per scope/task pack | Incorporated | Phase 3 (T3.1–T3.3) | Core Sprint 2 objective from findings 03. |
| 3 | Include `check:context-pack` in release checklist and CI once Sprint 2 fixtures stabilize | Incorporated | Phase 3, T3.4 | Sprint 1 added the script; this sprint stabilizes task-pack fixtures and documents the release gate. |
| 4 | Decide release version bump (3.4.3 vs 3.5.0) | Deferred | Sprint 3 / release | Task packs and budget routing should land before choosing minor vs patch bump. |

---

## Phases

### Phase 1 — Task Selection

**Objective**: Resolve task identity from CLI options and active sprint artifacts, then extract a compact task slice without loading full sprint Markdown bodies into output.

**Tasks**:

- [x] **T1.1**: Add `--task <id>` to CLI option parsing and help.
  - Files: `src/cli/options.ts`, `src/cli/types.ts`, `src/cli/help.ts`
  - Evidence: `CliOptions` includes `task: string | null`; help documents `--task` alongside `--kyro-scope` and `--json`.
  - Verification: `node dist/cli.js context-pack --help` mentions `--task`.

- [x] **T1.2**: Default task resolution from `index.json` `nextTask` when `--task` is omitted during active sprint execution.
  - Files: `src/cli/commands/context-pack.ts`
  - Evidence: When `state.activeSprint` is set and `--task` is absent, resolve task id from `index.nextTask` (e.g. `T1.2`) with a warning when fallback is used.
  - Verification: Task mode activates for scopes with active sprint and `nextTask` set.

- [x] **T1.3**: Parse active sprint Markdown for the requested task block.
  - Files: `src/cli/commands/context-pack.ts`, new helper e.g. `src/cli/artifacts/task-parser.ts`
  - Evidence: Extract task id, description, files list, and verification criteria from `- [x] **T{n}.{m}**:` blocks without emitting unrelated phases or retro sections.
  - Verification: `kyro context-pack --kyro-scope <scope> --task T1.2 --json` includes parsed fields for a fixture sprint.

- [x] **T1.4**: Expose fallback Markdown path references when summaries are insufficient.
  - Files: `src/cli/commands/context-pack.ts`, `src/cli/artifacts/paths.ts`
  - Evidence: Task pack includes `sourceMarkdown` path to active sprint file and `sprintSummary` path; no full Markdown body in JSON/text output.
  - Verification: Output references paths only; fixture asserts sprint retro/recommendations text is absent from pack body.

### Phase 2 — Rule and Evidence Filtering

**Objective**: Shrink task packs by including only matching rules and compact execution evidence references.

**Tasks**:

- [x] **T2.1**: Extend `ContextPackOutput` with task-specific fields.
  - Files: `src/cli/types.ts`, `src/cli/commands/context-pack.ts`
  - Evidence: Task mode adds `packMode: "scope" | "task"`, `taskId`, `taskDescription`, `taskFiles`, `taskVerification`, `evidencePaths`.
  - Verification: TypeScript compiles; JSON shape is stable and documented.

- [x] **T2.2**: Filter `rules.index.json` entries by `affectedModes` in task mode.
  - Files: `src/cli/commands/context-pack.ts`
  - Evidence: Task packs include rules tagged with `execute-task` and/or `review-task` only; scope packs keep current behavior or use a narrower default set.
  - Verification: Task pack for demo scope has fewer rules than scope pack (~403 tokens baseline from Sprint 1).

- [x] **T2.3**: Add compact evidence references without embedding event payloads.
  - Files: `src/cli/commands/context-pack.ts`, `src/cli/artifacts/paths.ts`
  - Evidence: Include `events.ndjson` path and active `SPRINT-*.summary.json` path when present; do not inline event lines.
  - Verification: Task pack lists paths; no `events.ndjson` content in output.

- [x] **T2.4**: Implement task-mode text output distinct from scope-mode layout.
  - Files: `src/cli/commands/context-pack.ts`
  - Evidence: Text output leads with Task section (id, description, files, verification) before minimal scope routing context.
  - Verification: Human-readable task pack is clearly narrower than scope pack for the same scope.

### Phase 3 — Regression Fixtures and Release Gates

**Objective**: Lock scope-pack and task-pack budgets with fixtures and document the validation gate.

**Tasks**:

- [x] **T3.1**: Add task-pack golden fixture for active sprint + task.
  - Files: `scripts/check-context-pack-fixtures.mjs`, `fixtures/context-pack/task-demo.json`, `fixtures/artifact-integrity/valid/**`
  - Evidence: Fixture runs `context-pack --kyro-scope demo --task T1.2 --json` and compares normalized output.
  - Verification: `npm run check:context-pack` passes with task fixture.

- [x] **T3.2**: Add budget ceiling assertions for scope and task packs.
  - Files: `scripts/check-context-pack-fixtures.mjs`, `fixtures/context-pack/budgets.json`
  - Evidence: Budget file declares `maxEstimatedTokens` per pack type; fixture fails when exceeded without golden/budget update.
  - Verification: Artificially lowering ceiling in fixture test causes non-zero exit.

- [x] **T3.3**: Assert unrelated sprint Markdown is not embedded in packs.
  - Files: `scripts/check-context-pack-fixtures.mjs`
  - Evidence: Fixture checks task pack output does not contain retro headings, recommendation lists, or other phase task bodies.
  - Verification: Negative-string assertions pass for demo fixture.

- [x] **T3.4**: Update docs and release checklist for task packs and `check:context-pack`.
  - Files: `docs/cli.md`, `docs/context-management.md`, `docs/release-checklist.md`, `docs/cost-optimization-audit.md` (if budget table exists)
  - Evidence: Docs describe `--task`, task-mode rule filtering, budget fixtures, and release gate ordering.
  - Verification: `npm run check:links` passes.

- [x] **T3.5**: Rebuild `dist/` and run full package checks.
  - Files: `dist/**`, `package.json`
  - Evidence: `npm run build`, `npm run check`, `npm run check:context-pack`, `npm run check:tokens`, `doctor --artifacts --kyro-scope 01-token-cost-optimization`.
  - Verification: All checks exit `0`.

---

## Emergent Phases

<!-- Populated during execution when new work is discovered. -->

---

## Findings Consolidation

<!-- Filled during sprint CLOSE. -->

| # | Finding | Origin Phase | Impact | Action Taken |
|---|---------|-------------|--------|-------------|
| 1 | `--task` alone defaults to `index.nextTask`; omitted `--task` keeps scope mode | Phase 1 | medium | Preserved backward-compatible scope packs; documented in docs and retro |
| 2 | `index.nextTask` may be prose, not `T{n}.{m}` | Phase 1 | low | Explicit `--task <id>` required when nextTask is not a task code |

---

## Accumulated Technical Debt

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| — | No inherited debt | — | — | — | — |

**Status values**: `open` | `in-progress` | `resolved` | `deferred` | `carry-over`

---

## Definition of Done

- [x] All phase tasks completed or explicitly skipped with justification
- [x] `kyro context-pack --kyro-scope <scope> --task <id>` emits task-only context with filtered rules
- [x] Budget regression fixtures pass for scope and task packs
- [x] Unrelated sprint Markdown is not embedded in pack output
- [x] `npm run check` and `npm run check:context-pack` pass after `dist/` rebuild
- [x] Retro section filled
- [x] Recommendations for Sprint 3 documented
- [x] Re-entry prompts updated to reflect current state

---

## Retro

<!-- Filled when the sprint is CLOSED. -->

### What Went Well

- Task parser reuses sprint checkbox conventions and stops at phase boundaries.
- Fixture checker composes with `artifact-integrity/valid` and locks budgets via `fixtures/context-pack/budgets.json`.
- Task-mode rule filtering removes planning-only rules while keeping execute/review guidance.

### What Didn't Go Well

- Initial budget assertion assumed task packs are always smaller than scope packs; metadata fields can invert that relationship.

### Surprises / Unexpected Findings

- `index.nextTask` in real scopes may be prose; bare `--task` fallback works only when nextTask is a `T{n}.{m}` id.

### New Technical Debt Detected

- None blocking Sprint 3.

---

## Recommendations for Sprint 3

1. Add provider-neutral budget classes to config/types and surface selected class in context-pack output.
2. Normalize `index.nextTask` to task ids during sprint execution or teach context-pack to map prose nextTask to sprint Markdown tasks.
3. Add `check:context-pack` to CI workflow YAML alongside artifact fixtures.