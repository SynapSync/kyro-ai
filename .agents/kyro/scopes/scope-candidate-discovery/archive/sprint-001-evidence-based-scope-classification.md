---
title: 'scope-candidate-discovery — Sprint 1: Evidence-based scope classification'
date: '2026-08-16'
scope: 'scope-candidate-discovery'
sprint: 1
slug: 'evidence-based-scope-classification'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 1: Evidence-based scope classification

> Closed: 2026-08-16
> Outcome: shipped

## Objective

Classify scope directories from evidence, make every consumer respect that classification, and make the resulting contamination cleanable.

## Definition of Done

- A directory with no Kyro artifacts never blocks integrity, never resolves, and is never registered.
- A scope with a usable close checkpoint but no sprint.json stays discoverable and is reported as recoverable.
- Kyro artifacts without a usable checkpoint are reported as damaged with no promise of recovery.
- A registry entry pointing at a foreign directory is cleanable with the directory preserved byte for byte.
- An explicit foreign scope fails SCOPE_NOT_FOUND on every entry point that accepts one.
- The blast-radius gate covers the matrix and fails when either fix is reverted.
- npm run check passes end to end and the real workspace stays green.

## Phases

### P1 — Classification primitives

> Introduce a neutral checkpoint survey and an evidence-based directory classifier without inverting layers.

#### T1.1: Add a neutral checkpoint discovery module

**Status**: done

**Description**: Add src/cli/checkpoints/discovery.ts returning structured facts about a scope's close checkpoints, built on resolveEffectiveCheckpointAtPath so a checkpoint only counts when it resolves and its identity names the scope.

**Evidence**:
- Summary: Added src/cli/checkpoints/discovery.ts returning structured checkpoint facts built on resolveEffectiveCheckpointAtPath, and removed the duplicate checkpoint listing from integrity-plan.ts.
- Validation: A checkpoint copied from another scope is correctly rejected as unusable (identity mismatch), proving presence alone is not the signal
- Validation: artifacts/ imports checkpoints/, never commands/; verified src/cli/checkpoints does not import artifacts/scopes so no cycle exists
- Validation: npm run typecheck and npm run build clean
- Files changed: `src/cli/checkpoints/discovery.ts`, `src/cli/repair/integrity-plan.ts`

**Verdict**: pass

---
#### T1.2: Classify scope directories from evidence

**Status**: done

**Description**: Add the five-way directory classifier and derive listOwnedScopeDirectories, listRegistrableScopeDirectories and listForeignScopeDirectories from it. Keep listScopeFolders as a compatibility wrapper. Extract readScopeSprint as the single sprint reader and remove the 4.47.1 trace-only special case.

**Evidence**:
- Summary: Added SCOPE_DIR_CLASS with the five-way classifier, derived listOwnedScopeDirectories / listRegistrableScopeDirectories / listForeignScopeDirectories from it, kept listScopeFolders as a compatibility wrapper, extracted readScopeSprint, and deleted the trace-only special case.
- Validation: Sandbox: notes-backup and .ds-junk classify FOREIGN; global prepare returns blockers: []
- Validation: check:blast-radius-isolation still asserts a trace-only leftover is never a scope, now via the general rule
- Validation: Falsification: replacing the owned-class filter with a pass-through makes the gate fail
- Files changed: `src/cli/artifacts/scopes.ts`

**Verdict**: pass

---
### P2 — Consumers and repair

> Make classification actually govern registry classification, integrity reporting, registry writes and explicit scope arguments.

#### T2.1: Derive registry classification from both axes

**Status**: done

**Description**: Classify from the cross product of directory class and registry membership: distinguish recoverable, owned-damaged and corrupt instead of one bucket, treat a registered foreign directory as an orphan, and stop reporting a registered scope with an invalid sprint.json as healthy.

**Evidence**:
- Summary: classifyOne now derives from directory class crossed with registry membership: recoverable, owned-damaged and corrupt are distinct; a registered id whose directory is foreign becomes a registered orphan; a registered scope with an invalid sprint.json is no longer reported as healthy.
- Validation: Sandbox: registered entry + foreign directory produces targets.unregister, not a blocker
- Validation: Sandbox: demo without sprint.json but with its own checkpoint classifies recoverable, not irreconcilable
- Validation: check:scope-remediation 716 assertions and check:repair-integrity 90 assertions still pass
- Files changed: `src/cli/project/reconcile.ts`

**Verdict**: pass

---
#### T2.2: Report recoverable and damaged as different blockers

**Status**: done

**Description**: Add distinct integrity blocker codes so a scope with a usable checkpoint points at the resume path while Kyro artifacts without one are reported as damaged with no promise of recovery.

**Evidence**:
- Summary: Added recoverable-no-sprint and owned-damaged blocker codes with distinct messages; corrupt sprint.json keeps irreconcilable.
- Validation: Sandbox: recoverable-no-sprint reports '1 usable close checkpoint(s) in archive/ can resume it'
- Validation: Sandbox: a directory whose only checkpoint is unreadable reports owned-damaged and never claims recoverability
- Files changed: `src/cli/repair/integrity-plan.ts`

**Verdict**: pass

---
#### T2.3: Make contaminated registry entries cleanable

**Status**: done

**Description**: Change unregister-orphan so it re-verifies the directory is still foreign at apply time, aborts if Kyro evidence appeared, removes only the registry entry, and never modifies the directory.

**Evidence**:
- Summary: applyUnregister re-classifies at apply time and proceeds only when the directory is absent or still foreign, removing just the registry entry.
- Validation: Sandbox: contaminated entry cleaned; README.md SHA-256 identical before and after; directory still present
- Validation: Falsification: restoring the old existsSync guard makes the gate fail with 'Scope directory notes-backup reappeared before apply'
- Files changed: `src/cli/repair/integrity-apply.ts`

**Verdict**: pass

---
#### T2.4: Restrict registry writes and explicit scope arguments

**Status**: done

**Description**: Point rehydrate and the install prompt at registrable directories only, remove the fabricated planning fallback, and reject an explicit scope naming a foreign directory across resolution, integrity prepare and artifact doctor.

**Evidence**:
- Summary: rehydrate and the install prompt now use listRegistrableScopeDirectories, the fabricated planning fallback is gone, and assertNotForeignDirectory guards resolution, integrity prepare and artifact doctor.
- Validation: Sandbox: status, context-pack, repair integrity prepare and doctor --artifacts with --kyro-scope notes-backup all exit non-zero with SCOPE_NOT_FOUND
- Validation: check:install-rehydrate updated and passing: a foreign directory is no longer registered
- Files changed: `src/cli/core/scopes.ts`, `src/cli/commands/install.ts`, `src/cli/core/scope-resolution.ts`, `src/cli/repair/integrity-plan.ts`, `src/cli/commands/artifact-doctor.ts`

**Verdict**: pass

---
### P3 — Advisory, gate and documentation

> Keep ignored directories visible without blocking, prove the whole contract, and record the behaviour change.

#### T3.1: Warn about ignored directories on global doctor only

**Status**: done

**Description**: Add a non-blocking doctor check listing directories under scopes/ that are not Kyro scopes, emitted only when no scope is requested.

**Evidence**:
- Summary: Added checkForeignScopeDirectories, a WARN-only doctor check emitted solely when no scope is requested.
- Validation: Sandbox: global doctor prints '[WARN] scope directories: 2 ... ignored: .ds-junk, notes-backup' and exits 0
- Validation: Sandbox: doctor --kyro-scope demo does not emit the warning
- Files changed: `src/cli/commands/doctor.ts`

**Verdict**: pass

---
#### T3.2: Extend the blast-radius gate to the full matrix

**Status**: done

**Description**: Add regressions for foreign directories, recoverable versus damaged, pre-existing contamination with byte preservation, and explicit foreign scope arguments, rather than adding another bespoke check script.

**Evidence**:
- Summary: Extended check:blast-radius-isolation with foreign-directory, recoverable-vs-damaged, pre-existing-contamination and explicit-foreign-scope regressions, and rewrote the check-install-rehydrate assertion that encoded the defect. No new check script was added.
- Validation: Falsification 1: pass-through discovery filter makes the gate fail
- Validation: Falsification 2: restoring the old unregister guard makes the gate fail
- Validation: Contamination case asserts SHA-256 equality of the foreign file before and after apply
- Validation: npm run check passes end to end, exit 0
- Files changed: `scripts/check-blast-radius-isolation.mjs`, `scripts/check-install-rehydrate.mjs`

**Verdict**: pass

---
#### T3.3: Document the behaviour change

**Status**: done

**Description**: Record the change under Unreleased and correct the docs that describe rehydration and doctor warnings, without deciding a release version.

**Evidence**:
- Summary: Recorded the behaviour change under CHANGELOG Unreleased and corrected docs/teams.md rehydration wording and docs/cli.md doctor warning list. No version field touched.
- Validation: check:versions still reports all versions matching 4.47.1
- Validation: check:links passes over the edited docs
- Files changed: `CHANGELOG.md`, `docs/teams.md`, `docs/cli.md`

**Verdict**: pass

---

## Learnings

- The first plan proposed a rule (no sprint.json means not a scope) that would have hidden the very case recover mode exists to rescue; the counter-rule matters as much as the rule.
- A narrowing rule needs its own repair path: unregister-orphan refused whenever the path existed, which would have made the new classification a dead end for anyone already contaminated.
- A test asserted the defect as expected behaviour (an empty folder registering as a planning scope), so the suite was green while the bug was live.

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 2

- Move the Unreleased entry into a version before publishing; 4.47.1 is already on npm.
- Consider promoting the evidence-over-path rule to a global convention with kyro rule add --global.
- Next line: honest provenance for maker/checker and approvals, then startup consolidation.
