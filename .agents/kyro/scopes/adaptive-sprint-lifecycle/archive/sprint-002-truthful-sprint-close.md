---
title: 'adaptive-sprint-lifecycle — Sprint 2: Truthful sprint close and open-scope routing'
date: '2026-08-26'
scope: 'adaptive-sprint-lifecycle'
sprint: 2
slug: 'truthful-sprint-close'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 2: Truthful sprint close and open-scope routing

> Closed: 2026-08-26
> Outcome: shipped

## Objective

Make scope completion and later continuation explicit, auditable lifecycle decisions without turning ordinary sprint closure into a terminal block.

## Definition of Done

- Scope completion, reopening, and retirement have distinct typed transitions and rendered states.
- No ordinary sprint close infers completion or blocks lawful future planning.
- All new lifecycle transitions are tool-owned, fail closed on invalid state, and preserve immutable archives.
- Focused lifecycle regressions and the full project validation suite pass.

## Phases

### P1 — Explicit scope-completion contract

> Define and implement a minimal tool-owned completion statement distinct from retirement.

#### T2.1: Model explicit scope completion and historical compatibility

**Status**: done

**Description**: Add the smallest typed completion record and derived-status rules so completed, retired, and still-open scopes have distinct, truthful meanings without rewriting legacy checkpoints.

**Evidence**:
- Summary: Modeled explicit scope completion as a typed, tool-owned record distinct from retirement: added ScopeCompletion and SprintFile.completion / KyroScopeEntry.completion; schema validation rejects malformed completion and completion+retirement coexistence (both on sprint.json and project-state scope entries) and requires status=completed, activeSprint=null, nextAction=done; deriveScopeStatus now marks completed only from explicit completion, retirement, or a legacy done handoff (readable), never from roadmap exhaustion; added COMPLETION_CONFLICT error code; added T2.1 regression coverage in check-status.mjs (derivation, validation, legacy read, entry validation).
- Validation: npm run typecheck
- Validation: npm run check
- Validation: node scripts/check-status.mjs
- Files changed: `src/cli/types.ts`, `src/cli/artifacts/schema.ts`, `src/cli/core/status.ts`, `src/cli/core/errors.ts`, `scripts/check-status.mjs`

**Verdict**: pass

---
#### T2.2: Implement guarded scope completion

**Status**: done

**Description**: Extend the existing scope command with an explicit completion transition that validates readiness, writes only tool-owned lifecycle state, and requires deliberate confirmation.

**Evidence**:
- Summary: Implemented guarded scope completion via a new 'kyro scope complete' subcommand (distinct from retirement): validates readiness (no active sprint, no open debt, no review debt, no blocking findings, healthy close checkpoints), requires deliberate confirmation (scope_complete policy guard at confirm level), writes only tool-owned lifecycle state (sprint.json completion record + project-state scope entry status/completion), and never creates a retirement checkpoint or rewrites archive/. Added COMPLETION_CONFLICT and NOT_READY_TO_COMPLETE error codes, scope_complete to GuardedOperation/default policy, mutating-invocation wiring in app.ts, help documentation, cloneScopeEntry completion preservation in state.ts, and end-to-end regression coverage in check-scope-retire.mjs (refuses active sprint/debt, dry-run, unconfirmed, happy apply, double-complete conflict, status/context-pack visibility).
- Validation: npm run typecheck
- Validation: npm run check
- Validation: node scripts/check-scope-retire.mjs
- Validation: node scripts/check-status.mjs
- Files changed: `src/cli/commands/scope.ts`, `src/cli/app.ts`, `src/cli/core/policy.ts`, `src/cli/help.ts`, `src/cli/state.ts`, `src/cli/core/errors.ts`, `src/cli/types.ts`, `scripts/check-scope-retire.mjs`

**Verdict**: pass

---
### P2 — Deliberate continuation and certification

> Allow a completed-but-not-retired scope to resume planning explicitly, then prove the lifecycle boundaries end to end.

#### T2.3: Implement explicit scope reopen for later planning

**Status**: done

**Description**: Add an auditable reopen transition for a completed, non-retired scope so new work can return to plan_sprint without manual state edits or recovery.

**Evidence**:
- Summary: Added tool-owned 'kyro scope reopen': an explicitly completed, non-retired scope returns to plan_sprint under one locked, digest-bound, resumable transaction that clears the live completion and preserves it in append-only completionHistory (sprint.json + registry). Shared after-state builders (checkpoints/lifecycle-state.ts) are now the single source of truth for both writers and for checkpoint verification, which replays recorded lifecycle transitions from the close after-image instead of trusting the records — closing the divergence hole that made a completed or reopened scope read as tampered.
- Validation: npm run check (full suite, exit 0) including typecheck, dist freshness, and every contract script
- Validation: node scripts/check-scope-retire.mjs: new reopen contract — happy path, plan-after-reopen (S3/S7), refusals for open/retired/malformed/unknown/second-reopen without writes, dry-run and CONFIRMATION_REQUIRED, fault-injected resume (KYRO_TEST_REOPEN_FAIL_AFTER=sprint) and DIVERGED on concurrent registry edit
- Validation: archive/ byte digest asserted identical across completion, reopen, planning, resume, and every refusal path
- Files changed: `src/cli/checkpoints/scope-reopen.ts`, `src/cli/checkpoints/lifecycle-state.ts`, `src/cli/checkpoints/scope-completion.ts`, `src/cli/commands/scope.ts`, `src/cli/commands/plan.ts`, `src/cli/commands/context-pack.ts`, `src/cli/commands/artifact-doctor.ts`, `src/cli/core/status.ts`, `src/cli/core/policy.ts`, `src/cli/core/errors.ts`, `src/cli/artifacts/schema.ts`, `src/cli/remediation/plan.ts`, `src/cli/types.ts`, `src/cli/state.ts`, `src/cli/app.ts`, `src/cli/help.ts`, `scripts/check-scope-retire.mjs`

**Verdict**: pass

---
#### T2.4: Certify completion, reopen, and integrity boundaries

**Status**: done

**Description**: Extend existing lifecycle and integrity gates with end-to-end adversarial cases and update only the user-facing guidance required by the final contract.

**Evidence**:
- Summary: Extended the existing gates (no new harness) with adversarial S4 coverage and updated the user-facing contract. check-scope-retire now proves lawful lifecycle evolution stays healthy and is labelled 'explicit lifecycle transition', that completing again after a reopen replays correctly, and that state edited beyond a transition, a rewritten lifecycle record, or a corrupt immutable narrative each still fail closed as DIVERGED. check-status adds the reopen derivation model plus malformed/empty/out-of-order history rejection; check-plan adds the refusal that stops planning from bypassing completion (remedy names reopen; a retired scope is never offered it); check-close-handoff asserts close never mints completion, history, or retirement. docs/cli.md and docs/status-coherence.md document the three distinct lifecycle facts and the replay-based verification.
- Validation: npm run check: exit 0 (full suite, including typecheck, dist freshness, and all contract scripts)
- Validation: node dist/cli.js doctor --artifacts --kyro-scope adaptive-sprint-lifecycle: all PASS, exit 0
- Validation: node dist/cli.js analyze --kyro-scope adaptive-sprint-lifecycle: no semantic issues, exit 0
- Validation: node dist/cli.js repair integrity prepare --json: no findings, no blockers, exit 0
- Validation: npm pack --dry-run: tarball builds, 713 files
- Files changed: `scripts/check-scope-retire.mjs`, `scripts/check-status.mjs`, `scripts/check-plan.mjs`, `scripts/check-close-handoff.mjs`, `docs/cli.md`, `docs/status-coherence.md`

**Verdict**: pass

---

## Unfinished work

_None — every task is done with a passing verdict._

## Learnings

- Adding a lawful post-close state transition is incomplete until the integrity lens learns to replay it — completion (T2.2) silently left every completed scope reading as DIVERGED until reopen forced the checkpoint verifier to be taught the transition.
- Sharing one set of after-state builders between the writers and the verifier removes a whole class of drift: the verifier cannot disagree with the writer about what a lawful transition produces.

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 3

- Before completing this scope, verify each success criterion against evidence rather than treating all-tasks-done as proof the objective was met.
- If further lifecycle transitions are added (e.g. suspend/resume), extend checkpoints/lifecycle-state.ts and its replay first, then the command surface.
