---
title: 'managed-checkpoint-path-safety — Sprint 1: Authoritative managed path survey'
date: '2026-08-18'
scope: 'managed-checkpoint-path-safety'
sprint: 1
slug: 'authoritative-managed-path-survey'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 1: Authoritative managed path survey

> Closed: 2026-08-18
> Outcome: shipped

## Objective

Establish one fail-closed managed-path survey and make every checkpoint consumer respect its registry-aware safety result.

## Definition of Done

- No managed discovery read follows a symlink at any relevant level.
- Integrity and Doctor agree for every safe, foreign, damaged and recoverable fixture.
- Foreign unsafe debris cannot block unrelated scopes or influence classification through its target.
- Registered or independently owned unsafe state never produces a write operation or recovery promise.
- Safe registry contamination remains cleanable and unsafe divergence aborts without writes.
- Every requested gate and mutation falsification passes for the intended reason.

## Phases

### P1 — Safe discovery primitives

> Represent path safety explicitly before any managed artifact is read or enumerated.

#### T1.1: Harden managed path validation

**Status**: done

**Description**: Make assertSafeManagedPath detect dangling symlinks and reject symlinked or non-directory ancestors without following them.

**Evidence**:
- Summary: Hardened managed-path ancestry checks and stabilized lease-worker startup under filesystem load.
- Validation: npm run typecheck
- Validation: npm run check:lossless-checkpoints
- Validation: npm run check:scope-remediation
- Files changed: `src/cli/pipeline/state-writer-lock.ts`, `scripts/check-lossless-checkpoints.mjs`

**Verdict**: pass

---
#### T1.2: Make checkpoint survey authoritative

**Status**: done

**Description**: Extend the survey with container status, issue level and safe entry facts; never collapse unsafe or unreadable paths to an empty survey.

**Evidence**:
- Summary: Implemented the canonical checkpoint survey with explicit root, sprint, archive and checkpoint safety facts.
- Validation: npm run check:blast-radius-isolation
- Validation: npm run check:repair-integrity
- Files changed: `src/cli/checkpoints/discovery.ts`, `src/cli/artifacts/scopes.ts`, `src/cli/checkpoints/canonicalize.ts`

**Verdict**: pass

---
### P2 — Registry-aware consumer parity

> Apply the same safety facts to classification, repair, Doctor and checkpoint consumers.

#### T2.1: Apply the registry and evidence matrix

**Status**: done

**Description**: Keep unregistered unsafe entries without Kyro evidence foreign and advisory, while treating registered or evidenced unsafe state as owned-damaged; protect rehydrate and unregister.

**Evidence**:
- Summary: Applied the registry-by-evidence matrix to reconciliation, rehydration, resolution and unregister apply.
- Validation: npm run check:blast-radius-isolation
- Validation: npm run check:install-rehydrate
- Validation: npm run check:repair-integrity
- Files changed: `src/cli/project/reconcile.ts`, `src/cli/core/scopes.ts`, `src/cli/core/scope-resolution.ts`, `src/cli/repair/integrity-apply.ts`, `src/cli/commands/install.ts`

**Verdict**: pass

---
#### T2.2: Unify Integrity and Doctor

**Status**: done

**Description**: Render the survey's issues consistently and exclude every unsafe path from operations, commitments, canonicalization, latest-checkpoint selection, retirement and resume.

**Evidence**:
- Summary: Unified Integrity, Doctor, close-sprint, remediation and retirement around safe checkpoint inputs.
- Validation: npm run check:blast-radius-isolation
- Validation: npm run check:scope-retire
- Validation: npm run check:canonicalization-gate
- Files changed: `src/cli/repair/integrity-plan.ts`, `src/cli/commands/artifact-doctor.ts`, `src/cli/commands/doctor.ts`, `src/cli/commands/close-sprint.ts`, `src/cli/checkpoints/effective.ts`, `src/cli/checkpoints/scope-retirement.ts`, `src/cli/remediation/plan.ts`

**Verdict**: pass

---
### P3 — Adversarial certification

> Prove isolation, no-dereference, cleanup compatibility and load-bearing guards.

#### T3.1: Extend the blast-radius matrix

**Status**: done

**Description**: Add portable root, sprint, archive, record and checkpoint path fixtures plus target-mutation and prepare/apply divergence coverage to the existing gate.

**Evidence**:
- Summary: Extended existing gates with adversarial managed-path, no-dereference, rehydrate and prepare/apply race coverage.
- Validation: npm run check:blast-radius-isolation
- Validation: npm run check:install-rehydrate
- Validation: npm run check:lossless-checkpoints
- Files changed: `scripts/check-blast-radius-isolation.mjs`, `scripts/check-install-rehydrate.mjs`, `scripts/check-lossless-checkpoints.mjs`, `scripts/check-scope-remediation.mjs`

**Verdict**: pass

---
#### T3.2: Synchronize operator documentation

**Status**: done

**Description**: Update Unreleased and CLI/team guidance to explain ancestor safety and FOREIGN plus WARN behavior without changing version metadata.

**Evidence**:
- Summary: Documented ancestor safety, FOREIGN plus WARN isolation and safe rehydration under Unreleased.
- Validation: npm run check:links
- Validation: npm run check:versions
- Validation: git diff --check
- Files changed: `CHANGELOG.md`, `docs/cli.md`, `docs/teams.md`

**Verdict**: pass

---
#### T3.3: Run full certification

**Status**: done

**Description**: Execute package, real-workspace, adversarial and independent QA gates and record only evidence produced by the actual commands.

**Evidence**:
- Summary: Completed full package, adversarial, real-workspace and independent QA certification with no Critical or Major findings.
- Validation: npm run typecheck
- Validation: npm run build
- Validation: npm run check
- Validation: git diff --check
- Validation: npm pack --dry-run --json
- Validation: repair integrity prepare global: 0 findings, 0 blockers, 0 operations
- Validation: Doctor global and four required scoped audits: PASS
- Validation: five guard-removal falsifications failed their intended gates
- Validation: kyro-qa: APPROVED; no Critical, Major or Minor findings
- Files changed: 

**Verdict**: pass

---

## Learnings

- Path identity and path safety are separate axes: registration or regular Kyro evidence determines ownership, while lstat-based inspection determines whether a managed path is consumable.
- A durable initial lease permits a lease-relative worker startup budget, but protected work must still wait for the first completed renewal to avoid racing its atomic rename.

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 2

- Decide the next patch version only when authorizing release; local metadata remains 4.47.1.
- Continue maker/checker provenance and startup-contract consolidation as separate scopes.
