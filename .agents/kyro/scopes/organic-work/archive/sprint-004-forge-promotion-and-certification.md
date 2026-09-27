---
title: 'organic-work — Sprint 4: Forge Promotion and Certification'
date: '2026-09-27'
scope: 'organic-work'
sprint: 4
slug: 'forge-promotion-and-certification'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 4: Forge Promotion and Certification

> Closed: 2026-09-27
> Outcome: shipped

## Objective

Promote explicitly selected unfinished Work into a new Forge scope through a recoverable, reciprocal CLI transaction, resolve Sprint 3 QA debt, and certify the Work and Forge boundaries without releasing or installing globally.

## Definition of Done

- Every Sprint 4 task has current CLI-recorded evidence and a criterion-complete passing checker verdict; debt-1 and debt-2 are resolved only after their fixes are tested.
- Explicit promotion creates a new Forge scope with a reciprocal verified link and only pending Forge tasks, while interrupted or conflicting transactions never appear successful.
- Disposable and two-clone regressions cover Work source integrity, safe promotion/recovery, Forge isolation, adapters, packaging, and historical checkpoint coherence.
- The workspace build and full check suite pass, doctor/analyze report no critical or high findings, and independent Kyro QA is offered before a user-gated Sprint close.
- No release, version bump, global installation, or scope completion occurs without separate user authorization.

## Phases

### P1 — Source integrity and promotion contract

> Make the source brief trustworthy and define an exact, previewable translation that never inherits Work approval as Forge certification.

#### T4.1: Harden Work creation source ingestion

**Status**: done

**Description**: Resolve debt-1 by applying bounded, no-follow, lossless UTF-8 ingestion to work create. Hash and publish the original brief bytes, including valid Unicode and CRLF, without changing the Work v1 JSON shape or the shared digest helper.

**Evidence**:
- Summary: Hardened Work creation source ingestion: new shared bounded no-follow lossless UTF-8 reader used by work create and work amend-brief, byte-exact writer path, strict malformed/symlink/oversize/growth/swap rejection before publication, Unicode/CRLF/BOM preservation with digest over original bytes.
- Validation: npm run build
- Validation: npm run check:work-store
- Validation: npm run check:work-isolation
- Validation: npm run check:work-amend
- Files changed: `src/cli/work/brief-source.ts`, `src/cli/commands/work.ts`, `src/cli/work/store.ts`, `scripts/check-work-store.mjs`, `scripts/check-work-isolation.mjs`, `docs/work.md`

**Verdict**: pass

---
#### T4.2: Define and validate the Work-to-Forge promotion contract

**Status**: done

**Description**: Implement a pure promotion planner and exact validators for the source fingerprint, task mapping, reciprocal destination link, and CLI-owned pending transaction record. Make the preview disclose every transferred, omitted, blocked, and dependency-adjusted task before confirmation.

**Evidence**:
- Summary: Implemented pure Work-to-Forge promotion planner with deterministic Wn to T1.n mapping, explicit verified/disposed omission and verified-dependency adjudication, versioned reciprocal sidecar and pending journal schemas with non-circular digest formulas, closure-finalRevision coherence for promoted stopped Work, and read-only work promote dry-run preview CLI.
- Validation: npm run build
- Validation: npm run check:work-promotion-contract
- Validation: npm run check:work-contract
- Validation: npm run check:work-closure
- Validation: npm run check:cli-envelope
- Files changed: `src/cli/work/promotion.ts`, `src/cli/work/schema.ts`, `src/cli/types.ts`, `src/cli/commands/work.ts`, `scripts/check-work-promotion-contract.mjs`, `docs/work.md`, `package.json`

**Verdict**: pass

---
### P2 — Reciprocal publication and recovery

> Publish a new Forge scope and a promoted Work only as a verifiable, retryable cross-artifact operation.

#### T4.3: Stage a validated Forge destination without changing the active scope

**Status**: done

**Description**: Build a dedicated promotion adapter around the existing Forge schema and plan builders. Stage a new destination scope with an initial pending Sprint 1 and a reciprocal source link, while preserving current project.json and local.json bytes until an explicitly authorized Forge operation requires otherwise.

**Evidence**:
- Summary: Built dedicated promotion staging adapter around unmodified Forge plan builders: destination SprintFile via buildPlanInitPlan/buildPlanSprintPlan with mapped pending tasks and provenance context, hidden Work-local staging with reciprocal sidecar, collision/symlink/malformed/injected failure safety, no activeScope switch, ordinary plan init behavior preserved.
- Validation: npm run build
- Validation: npm run check:work-promotion
- Validation: npm run check:work-promotion-contract
- Validation: npm run check:plan
- Validation: npm run check:active-plan
- Files changed: `src/cli/work/promotion.ts`, `src/cli/types.ts`, `scripts/check-work-promotion.mjs`, `package.json`

**Verdict**: pass

---
#### T4.4: Commit and recover promotion through the Work CLI

**Status**: done

**Description**: Implement work promote with a durable pending journal, revision/digest compare-and-swap, scoped writer lock, explicit confirmation, reciprocal verification, and idempotent retry. The Work must not appear successfully promoted until the target is published and linked.

**Evidence**:
- Summary: Published complete promotion destinations by one durable directory rename, with atomic staging, exact journal recovery, and no incomplete runnable Forge scope.
- Validation: npm run build: passed
- Validation: npm run check: passed, including promotion recovery and Forge discovery fixtures
- Files changed: `src/cli/work/store.ts`, `src/cli/work/promotion.ts`, `scripts/check-work-promotion.mjs`

**Verdict**: pass

---
### P3 — Certification and debt closure

> Prove the promotion behavior and prior QA notes under realistic failure and host boundaries before considering release readiness.

#### T4.5: Close the promoted-reopen test gap and verify reciprocal diagnostics

**Status**: done

**Description**: Resolve debt-2 with a schema-valid promoted Work fixture and exercise reopen refusal. Extend doctor/status diagnostics so stale or missing reciprocal promotion material is reported as a blocker rather than an apparently healthy success.

**Evidence**:
- Summary: Restored fail-closed reciprocal diagnostics for canonical source path, actor, promotion timestamps, and recomputed request digest; schema-valid tampering now blocks both Work status and artifact doctor while legitimate Forge progress remains healthy.
- Validation: npm run build: PASS
- Validation: npm run check:work-promotion: PASS
- Validation: npm run check: PASS
- Validation: kyro doctor --artifacts --kyro-scope organic-work: PASS
- Validation: Workspace doctor: only known installed-runtime Work capability and adapter skew
- Files changed: `src/cli/work/store.ts`, `scripts/check-work-promotion.mjs`

**Verdict**: pass

---
#### T4.6: Run full promotion, clone, adapter, and package certification checks

**Status**: done

**Description**: Exercise the complete explicit Work-to-Forge path in disposable workspaces and two clones, update English help/docs/router guidance, and validate Work, Forge, adapters, packaging, and artifact integrity before independent QA is requested.

**Evidence**:
- Summary: Extended disposable promotion certification to reject schema-valid reciprocal sidecar identity substitutions through both Work status and artifact doctor; retained real Forge progress, atomic publication, retry, and isolation coverage.
- Validation: npm run build: PASS
- Validation: npm run check:work-promotion: PASS, including five schema-valid sidecar identity substitutions
- Validation: npm run check: PASS
- Validation: kyro doctor --artifacts --kyro-scope organic-work: PASS
- Validation: node dist/cli.js doctor --artifacts: environmental installed runtime and skill projection skew only
- Validation: kyro analyze: no CRITICAL or HIGH findings; transient MEDIUM phase status while T4.5/T4.6 are under remediation
- Validation: npm pack --dry-run: PASS
- Validation: git diff --check: PASS (untracked Sprint 1-4 files are not covered by git diff)
- Files changed: `scripts/check-work-promotion.mjs`, `src/cli/work/store.ts`

**Verdict**: pass

---

## Unfinished work

_None — every task is done with a passing verdict._

## Learnings

- Reciprocal provenance checks must compare schema-valid identity fields, not only shape or selected digests; test both Work status and artifact doctor.
- A complete Forge target must be staged and published with one directory rename so interruptions cannot expose a partially runnable scope.

## Resolved Debt

- **debt-1**: Harden work create source ingestion to reject malformed UTF-8 and preserve original brief bytes
- **debt-2**: Add schema-valid promoted Work reopen rejection regression

## Recommendations for Sprint 5

- At a separate release gate, decide whether to bump and publish the workspace build, install/sync the global runtime and kyro-work adapter, then rerun workspace artifact doctor.
- Ask the scope owner whether to complete organic-work or explicitly expand it; do not start another sprint automatically.
