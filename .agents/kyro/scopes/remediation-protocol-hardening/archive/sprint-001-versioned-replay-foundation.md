---
title: 'remediation-protocol-hardening — Sprint 1: Versioned replay foundation'
date: '2026-08-09'
scope: 'remediation-protocol-hardening'
sprint: 1
slug: 'versioned-replay-foundation'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 1: Versioned replay foundation

> Closed: 2026-08-09
> Outcome: shipped

## Objective

Make replay dispatch explicit and fail-closed for immutable remediation evidence before introducing a compact record representation.

## Definition of Done

- Version-aware replay dispatch is typed, fail-closed, and covered by real artifact vectors.
- Historical v1 remediation chains remain valid without mutation.
- npm run build, npm run check:scope-remediation, npm run check:verification-states, and npm run check pass.

## Phases

### P1 — Versioned replay contract

> Define the typed version-dispatch boundary from evidence parsing through replay validation.

#### T1.1: Model versioned replay witnesses

**Status**: done

**Description**: Introduce closed, strongly typed protocol/version discriminants for remediation results and replay witnesses; document the compatibility policy for v1 records and unknown future versions.

**Evidence**:
- Summary: Added explicit version-dispatched replay witness parsing with typed v1 output and fail-closed unsupported handling.
- Validation: OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf npm run build (passed)
- Validation: npm run check:replay-witness (5 assertions passed)
- Validation: npm run check:scope-remediation (292 assertions passed)
- Validation: npm run check:verification-states (143 assertions passed)
- Files changed: `src/cli/remediation/replay-witness.ts`, `src/cli/remediation/plan.ts`, `scripts/check-replay-witness.mjs`, `package.json`
- Notes: ADR-0001 records the v1 compatibility and future-version fail-closed policy.

**Verdict**: pass

---
### P2 — Historical compatibility vectors

> Prove that the new dispatch preserves historical integrity and rejects unsupported evidence.

#### T1.2: Certify version-aware replay vectors

**Status**: done

**Description**: Extend the real remediation and verification harnesses with v1 compatibility, unsupported-version, and multi-record chain cases.

**Evidence**:
- Summary: Certified explicit replay-witness dispatch with real v1 multi-record replay and unknown-version fail-closed vectors.
- Validation: OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf npm run build; npm run check:replay-witness (5 assertions); npm run check:scope-remediation (295 assertions); npm run check:verification-states (152 assertions)
- Files changed: `src/cli/remediation/replay-witness.ts`, `src/cli/remediation/plan.ts`, `scripts/check-replay-witness.mjs`, `scripts/check-scope-remediation.mjs`, `scripts/check-verification-states.mjs`, `package.json`

**Verdict**: pass

---

## Learnings

_No learnings recorded._

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 2

_None recorded._
