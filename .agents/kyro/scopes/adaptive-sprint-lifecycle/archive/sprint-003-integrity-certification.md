---
title: 'adaptive-sprint-lifecycle — Sprint 3: Integrity recalibration and lifecycle certification'
date: '2026-08-26'
scope: 'adaptive-sprint-lifecycle'
sprint: 3
slug: 'integrity-certification'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 3: Integrity recalibration and lifecycle certification

> Closed: 2026-08-26
> Outcome: shipped

## Objective

Prove that dispositions, truthful closes, explicit completion, and reopen replay identically through Doctor and Integrity without weakening immutable-artifact safety.

## Definition of Done

- All Sprint 3 tasks have tool-owned evidence and a pass verdict.
- The seven lifecycle scenarios replay through the compiled CLI without manual edits or archive rewrites.
- Doctor, Analyze, scoped Integrity prepare, and the full repository check pass.
- Each scope success criterion has explicit evidence or an honest unresolved disposition; scope completion remains a separate human decision.

## Phases

### P1 — Lifecycle replay parity

> Make lifecycle replay an observable, adversarially tested contract rather than a trusted record.

#### T3.1: Certify completion and reopen replay against artifacts

**Status**: done

**Description**: Exercise explicit completion and reopen from a closed checkpoint after-image, proving Doctor and Integrity accept only the state exactly rebuilt by the lifecycle builders and reject unexplainable drift.

**Evidence**:
- Summary: Made Integrity replay lifecycle records through the shared completion/reopen builders and require exact sprint plus registry reproduction; forged or extra lifecycle drift is now a scoped diverged blocker.
- Validation: npm run typecheck
- Validation: npm run build
- Validation: npm run check:scope-retire
- Files changed: `src/cli/checkpoints/lifecycle-state.ts`, `src/cli/commands/artifact-doctor.ts`, `src/cli/remediation/plan.ts`, `src/cli/repair/integrity-plan.ts`, `scripts/check-scope-retire.mjs`

**Verdict**: pass

---
### P2 — End-to-end adaptive lifecycle

> Prove the ordinary developer journey needs no manual state edits or recovery detour.

#### T3.2: Add an end-to-end partial-close, plan, complete, and reopen proof

**Status**: done

**Description**: Run the compiled CLI in an isolated workspace through disposition, truthful partial close, later sprint planning, explicit completion, and deliberate reopen, preserving checkpoints and traceability at every boundary.

**Evidence**:
- Summary: Added one compiled-CLI acceptance path from typed disposition through truthful partial close, follow-up planning, verified completion, and deliberate reopen; immutable archive bytes are checked across lifecycle-only steps.
- Validation: npm run build
- Validation: npm run check:scope-retire
- Files changed: `scripts/check-close-handoff.mjs`, `scripts/check-plan.mjs`, `scripts/check-scope-retire.mjs`

**Verdict**: pass

---
### P3 — Objective evidence and release decision

> Turn the scope success criteria into explicit evidence without auto-completing the scope or publishing a release.

#### T3.3: Verify success criteria and certify lifecycle readiness

**Status**: done

**Description**: Map every scope success criterion to the completed behavioral evidence and run the full repository and scoped integrity gates; report any remaining gap as debt or a blocker instead of asserting scope completion.

**Evidence**:
- Summary: Certified all five requirements: R1 typed disposition and immutable pre-close trace (T3.2 E2E); R2 truthful partial close/open scope (check-close-handoff); R3 normal follow-up plan after partial close (T3.2 E2E/check-plan); R4 exact Doctor and Integrity lifecycle replay with forged drift blocked (T3.1); R5 completion/reopen distinct from retirement and historical checkpoints readable (check-scope-retire). Scope completion remains an explicit human decision.
- Validation: npm run check
- Validation: node dist/cli.js doctor --artifacts --kyro-scope adaptive-sprint-lifecycle
- Validation: node dist/cli.js analyze --kyro-scope adaptive-sprint-lifecycle
- Validation: node dist/cli.js repair integrity prepare --kyro-scope adaptive-sprint-lifecycle --json
- Validation: git diff --check
- Files changed: `scripts/check-scope-retire.mjs`, `scripts/check-status.mjs`, `scripts/check-repair-integrity.mjs`

**Verdict**: pass

---

## Unfinished work

_None — every task is done with a passing verdict._

## Learnings

_No learnings recorded._

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 4

_None recorded._
