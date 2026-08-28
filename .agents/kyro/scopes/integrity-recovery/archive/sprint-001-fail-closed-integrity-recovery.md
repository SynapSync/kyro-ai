---
title: 'integrity-recovery — Sprint 1: Fail-closed integrity recovery'
date: '2026-08-15'
scope: 'integrity-recovery'
sprint: 1
slug: 'fail-closed-integrity-recovery'
outcome: 'completed'
type: 'sprint-archive'
---

# Sprint 1: Fail-closed integrity recovery

> Closed: 2026-08-15
> Outcome: completed

## Objective

Close the five blocking findings from the independent integrity-recovery review.

## Definition of Done

- All adversarial integrity assertions pass.
- Doctor, status, and context-pack accept the reconstructed scope.
- The complete npm check, diff check, and package dry-run pass.

## Phases

### P1 — Transactional integrity hardening

> Bind approval to executable bytes and make recovery replay idempotent and continuous.

#### T1.1: Authenticate warrant payload

**Status**: done

**Description**: Use one canonical approval payload for prepare, warrant validation, trace routing, and apply.

**Evidence**:
- Summary: Bound the executable warrant payload to the approved digest and made trace routing warrant-first.
- Validation: check-repair-integrity tampered-warrant and retry cases
- Files changed: `src/cli/repair/integrity-plan.ts`, `src/cli/repair/integrity-apply.ts`, `src/cli/commands/repair.ts`

**Verdict**: pass

---
#### T1.2: Make remediation replay idempotent

**Status**: done

**Description**: Replay the existing chain as the baseline, reuse applied or prepared records, and append later deltas continuously.

**Evidence**:
- Summary: Replayed anchored remediations into an effective baseline, reused applied/prepared batches, and continued later deltas from the previous result.
- Validation: check-repair-integrity same-digest, prepared-resume, and R-002 continuity cases
- Files changed: `src/cli/remediation/plan.ts`, `src/cli/repair/integrity-plan.ts`, `src/cli/repair/integrity-apply.ts`

**Verdict**: pass

---
#### T1.3: Reject invalid overlay chains

**Status**: done

**Description**: Inspect raw overlay candidates and verify every newly published overlay before success.

**Evidence**:
- Summary: Made canonicalization inspect raw candidates and the complete chain, then verify every published overlay before success.
- Validation: check-repair-integrity apply-after-overlay-tamper case
- Files changed: `src/cli/checkpoints/canonicalize.ts`, `src/cli/repair/integrity-apply.ts`

**Verdict**: pass

---
#### T1.4: Certify adversarial recovery

**Status**: done

**Description**: Expand portable tests to assert record count, byte invariance, prepared resume, later deltas, and Doctor postconditions.

**Evidence**:
- Summary: Expanded portable adversarial certification to cover warrant tampering, same-digest byte invariance, prepared resume, continuous R-002, overlay tampering, and Doctor postconditions.
- Validation: check-repair-integrity: 90 assertions passed
- Validation: npm run check: PASS
- Validation: npm pack --dry-run: 695 entries
- Files changed: `scripts/check-repair-integrity.mjs`

**Verdict**: pass

---

## Learnings

- Approval digests must authenticate the exact executable payload and warrants must be resolved before creating a new plan.
- Replay must distinguish the physical close checkpoint from the effective remediation-chain state to remain idempotent across retries and later evolution.

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 2

- Before delivery, stage only the integrity-recovery changes after reconciling them with the pre-existing staged worktree changes.
