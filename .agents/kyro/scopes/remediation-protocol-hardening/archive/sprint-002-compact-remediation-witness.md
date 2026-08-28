---
title: 'remediation-protocol-hardening — Sprint 2: Compact remediation witness'
date: '2026-08-09'
scope: 'remediation-protocol-hardening'
sprint: 2
slug: 'compact-remediation-witness'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 2: Compact remediation witness

> Closed: 2026-08-09
> Outcome: shipped

## Objective

Emit a compact, versioned remediation record and verify mixed historic and compact chains without rewriting any immutable evidence.

## Definition of Done

- New remediation records use a compact, strongly typed versioned witness and never embed a full SprintFile snapshot.
- Doctor and status preserve valid v1 verification and fail closed for malformed, forged, or unsupported v2 evidence.
- Real multi-record vectors prove deterministic replay, bounded archive growth, and byte-identical historic close artifacts.
- npm run build and npm run check pass.

## Phases

### P1 — Compact protocol producer

> Define and emit the strongly typed v2 record that replaces a full result snapshot with deterministic operation replay evidence.

#### T2.1: Define and emit compact remediation v2

**Status**: done

**Description**: Add the closed v2 remediation-record contract and change new remediation plans to emit it without embedding a SprintFile snapshot.

**Evidence**:
- Summary: Defined the closed v2 compact remediation record and emit a typed operations-replay witness instead of a full SprintFile snapshot.
- Validation: OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf npm run build; npm run check:compact-remediation-witness (9 assertions); npm run check:replay-witness (5 assertions); npm run typecheck
- Files changed: `src/cli/remediation/protocol.ts`, `src/cli/remediation/plan.ts`, `src/cli/remediation/transaction.ts`, `scripts/check-compact-remediation-witness.mjs`, `package.json`

**Verdict**: pass

---
### P2 — Mixed-chain replay

> Replay each record using its immutable protocol version rather than a stored full state image.

#### T2.2: Verify mixed v1 and compact chains

**Status**: done

**Description**: Refactor remediation inspection and rebase to dispatch v1 and v2 records explicitly, replay v2 operations directly, and keep doctor/status fail-closed.

**Evidence**:
- Summary: Replayed compact v2 operations directly while preserving versioned v1 snapshot replay; all remediation chains now replay before verification claims remediated.
- Validation: OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf npm run build; npm run check:scope-remediation (304 assertions); npm run check:verification-states (162 assertions); npm run check:compact-remediation-witness (9 assertions); npm run check:replay-witness (5 assertions); npm run typecheck
- Files changed: `src/cli/remediation/plan.ts`, `scripts/check-scope-remediation.mjs`, `scripts/check-verification-states.mjs`, `src/cli/remediation/protocol.ts`

**Verdict**: pass

---
### P3 — Growth and debt certification

> Prove compact records bound archive growth and close only the debt demonstrated by the new evidence.

#### T2.3: Certify bounded compact archives

**Status**: done

**Description**: Extend the real remediation harness with deterministic size and schema assertions, wire it into the full check, and resolve the scope debt items only when the relevant proof passes.

**Evidence**:
- Summary: Certified four-link compact v2 archive growth, wired compact witness coverage into the full check, and resolved both evidenced remediation debts through Kyro.
- Validation: OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf npm run check (passed); npm run check:scope-remediation (307 assertions); npm run check:compact-remediation-witness (9 assertions); npm run check:verification-states (162 assertions); npm run check:replay-witness (5 assertions)
- Files changed: `scripts/check-scope-remediation.mjs`, `scripts/check-compact-remediation-witness.mjs`, `scripts/check-replay-witness.mjs`, `package.json`
- Notes: debt-1 and debt-2 were resolved through kyro debt resolve only after the complete suite passed.

**Verdict**: pass

---

## Learnings

_No learnings recorded._

## Resolved Debt

- **debt-1**: Eliminate quadratic remediation result snapshots
- **debt-2**: Make replay validation version-aware

## Recommendations for Sprint 3

_None recorded._
