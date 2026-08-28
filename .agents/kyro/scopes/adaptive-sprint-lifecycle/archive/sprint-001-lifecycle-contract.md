---
title: 'adaptive-sprint-lifecycle — Sprint 1: Lifecycle contract and dispositions'
date: '2026-08-24'
scope: 'adaptive-sprint-lifecycle'
sprint: 1
slug: 'lifecycle-contract'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 1: Lifecycle contract and dispositions

> Closed: 2026-08-24
> Outcome: shipped

## Objective

Establish the minimal typed lifecycle contract that makes partial sprint outcomes truthful and keeps scopes open for subsequent planning.

## Definition of Done

- The lifecycle contract has source-grounded compatibility evidence.
- All Sprint 1 tasks have passing reviewed evidence.
- Focused lifecycle regressions and npm run check pass.
- Doctor scoped to adaptive-sprint-lifecycle passes after the implementation.

## Phases

### P1 — Contract characterization

> Turn the current implicit lifecycle behavior into a compatibility-aware contract.

#### T1.1: Map lifecycle owners and compatibility boundaries

**Status**: done

**Description**: Inventory every reader and writer affected by task state, close checkpoints, handoff routing, scope status, Doctor, Integrity, adapters, and fixtures; record the smallest compatible contract change.

**Evidence**:
- Summary: Mapped every lifecycle field this scope may change to a single writer and its readers, and recorded the additive task.disposition contract (extend record-evidence; no new CLI root).
- Validation: rg -n 'Lifecycle field owners' docs/plans/adr-adaptive-sprint-lifecycle.md
- Validation: rg -n 'One writer: extend .kyro record-evidence' docs/plans/adr-adaptive-sprint-lifecycle.md
- Validation: rg -n 'Historical bytes are not rewritten' docs/plans/adr-adaptive-sprint-lifecycle.md
- Files changed: `docs/plans/adr-adaptive-sprint-lifecycle.md`, `docs/status-coherence.md`

**Verdict**: pass

---
#### T1.2: Add the typed task-disposition contract

**Status**: done

**Description**: Implement and validate the minimal disposition structure for unfinished tasks, including reason, actor, time, and required continuation references for deferred or superseded work.

**Evidence**:
- Summary: Added optional task.disposition (deferred|blocked|superseded|cancelled) with schema validation and record-evidence --disposition/--reason/--target. Invalid kinds, blank reasons, and bad continuation targets fail without writes. Existing v4 tasks remain valid when the field is omitted.
- Validation: npx tsc --noEmit
- Validation: node scripts/check-record-evidence.mjs
- Validation: node scripts/check-status.mjs
- Files changed: `src/cli/types.ts`, `src/cli/artifacts/schema.ts`, `src/cli/commands/record-evidence.ts`

**Verdict**: pass

---
### P2 — Truthful close semantics

> Make close-sprint capture partial work truthfully without terminalizing the scope.

#### T1.3: Make close-sprint derive truthful outcomes

**Status**: done

**Description**: Require every unfinished task to have a valid disposition, derive and persist the sprint outcome, and include dispositions in dry-run, checkpoint, ledger, snapshot, and narrative output.

**Evidence**:
- Summary: Made close-sprint reject undisposed unfinished work, derive a truthful partial/shipped outcome, preserve dispositions in close artifacts, and keep retries bound to the exact frozen semantic inputs.
- Validation: npm run build
- Validation: npm run typecheck
- Validation: npm run check:lossless-checkpoints
- Files changed: `src/cli/commands/close-sprint.ts`, `src/cli/checkpoints/sprint-close.ts`, `src/cli/core/status.ts`, `scripts/check-lossless-checkpoints.mjs`

**Verdict**: pass

---
#### T1.4: Decouple final sprint close from scope completion

**Status**: done

**Description**: Change status and handoff derivation so every non-retired scope remains open and routable after sprint close, including when the original roadmap has no remaining entries.

**Evidence**:
- Summary: Final P2 certification: every non-retired close remains routable to planning; close handoff and Integrity fixtures now assert the same post-close planning status.
- Validation: npm run build
- Validation: npm run typecheck
- Validation: npm run check:close-handoff
- Validation: npm run check:lossless-checkpoints
- Validation: npm run check:repair-integrity
- Validation: npm run check (non-TTY, exit 0)
- Validation: git diff --check
- Files changed: `src/cli/checkpoints/sprint-close.ts`, `src/cli/core/status.ts`, `src/cli/commands/plan.ts`, `src/cli/commands/close-sprint.ts`, `scripts/check-close-handoff.mjs`, `scripts/check-repair-integrity.mjs`, `docs/cost-model.md`

**Verdict**: pass

---
### P3 — Observability and regression contract

> Align reports and focused tests with the new lawful lifecycle.

#### T1.5: Expose dispositions in status and fresh-context routing

**Status**: done

**Description**: Report unresolved disposed work and the open-scope planning route without hiding independent ready work or presenting a false completion state.

**Evidence**:
- Summary: Status and fresh-context routing expose dispositions and keep open post-close scopes routed to planning: TaskSummary now reports verified completion separately from deferred/blocked/superseded/cancelled dispositions; context-pack derives scope status via deriveScopeStatus (matching kyro status) so an open post-close scope reads planning instead of a stale stored field; close-sprint.md guidance no longer equates exhausting the original roadmap with a completed scope.
- Validation: npm run typecheck
- Validation: npm run check
- Validation: node scripts/check-status.mjs
- Validation: node scripts/check-close-handoff.mjs
- Validation: node scripts/check-record-evidence.mjs
- Validation: node scripts/check-repair-integrity.mjs
- Validation: node scripts/check-lossless-checkpoints.mjs
- Files changed: `src/cli/commands/status.ts`, `src/cli/commands/context-pack.ts`, `internal/skills/sprint-forge/assets/modes/close-sprint.md`

**Verdict**: pass

---
#### T1.6: Add load-bearing lifecycle regressions

**Status**: done

**Description**: Extend existing lifecycle gates with adversarial partial-close, final-roadmap, invalid-disposition, historical, and retirement cases; avoid creating a duplicate test harness.

**Evidence**:
- Summary: Extended existing lifecycle gates with adversarial load-bearing regressions: check-close-handoff adds partial final-roadmap close (persists partial outcome, scope stays planning/plan_sprint, never done) and undisposed-task close refusal without writes; check-status adds deriveScopeStatus mutation guard (roadmap exhaustion without done handoff must derive planning, not completed) and CLI task-summary disposition/verified distinction; check-plan adds S3 (plan materializes a later sprint after an exhausted roadmap close through the normal route).
- Validation: npm run typecheck
- Validation: npm run check
- Validation: node scripts/check-close-handoff.mjs
- Validation: node scripts/check-status.mjs
- Validation: node scripts/check-record-evidence.mjs
- Validation: node scripts/check-plan.mjs
- Files changed: `scripts/check-close-handoff.mjs`, `scripts/check-status.mjs`, `scripts/check-plan.mjs`

**Verdict**: pass

---

## Learnings

_No learnings recorded._

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 2

_None recorded._
