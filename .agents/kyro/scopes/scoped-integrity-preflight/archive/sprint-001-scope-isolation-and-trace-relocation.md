---
title: 'scoped-integrity-preflight — Sprint 1: Scope-isolated preflight and trace relocation'
date: '2026-08-16'
scope: 'scoped-integrity-preflight'
sprint: 1
slug: 'scope-isolation-and-trace-relocation'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 1: Scope-isolated preflight and trace relocation

> Closed: 2026-08-16
> Outcome: shipped

## Objective

Bind the integrity preflight and its verification to the resolved scope, move trace out of the scope-discovery tree, and gate both against regression.

## Definition of Done

- All four startup surfaces resolve the scope before integrity prepare and pass --kyro-scope through prepare, apply and post-repair doctor.
- A healthy scope closes and passes scoped Doctor while an unrelated scope on disk is irreconcilable.
- An explicit global scan without --kyro-scope still reports the broken scope.
- No trace write can create a directory that scope discovery classifies as a scope, and leftover trace-only directories are ignored.
- Previous-location trace history stays readable and merges by timestamp with a stable tie-break.
- check:blast-radius-isolation runs in npm run check and fails when the contract regresses.
- npm run check passes end to end and scoped Doctor passes.

## Phases

### P1 — Scope-isolated preflight

> Make all four startup surfaces resolve the scope first and keep every integrity operation and its verification bound to that scope.

#### T1.1: Resolve scope before integrity prepare in the three routers

**Status**: done

**Description**: Reorder the startup steps in commands/forge.md, internal/skills/sprint-forge/SKILL.md and agents/orchestrator.md so the target scope is resolved before repair integrity prepare runs, and pass --kyro-scope to it. Stop when no single scope can be resolved instead of running an unscoped preflight.

**Evidence**:
- Summary: Reordered startup in the three routers so the scope resolves before repair integrity prepare, which now always receives --kyro-scope; an unresolvable scope stops and asks instead of running an unscoped preflight.
- Validation: check:blast-radius-isolation asserts scope resolution precedes prepare in all three routers and that no invocation omits --kyro-scope
- Validation: Sandbox: repair integrity prepare --kyro-scope demo --json returns findings=[] blockers=[] with an irreconcilable sibling scope present
- Validation: npm run check passes end to end (exit 0)
- Files changed: `commands/forge.md`, `internal/skills/sprint-forge/SKILL.md`, `agents/orchestrator.md`

**Verdict**: pass

---
#### T1.2: Keep recover mode scoped through apply and verification

**Status**: done

**Description**: Pass --kyro-scope to repair integrity prepare, repair integrity apply and the post-repair doctor --artifacts in recover mode, so a successful scoped repair is not undone by an unrelated scope's failure at verification time.

**Evidence**:
- Summary: Recover mode now passes --kyro-scope to repair integrity prepare, to repair integrity apply, and to the post-repair doctor --artifacts, and states why the flag must never be dropped.
- Validation: Confirmed in src/cli/commands/artifact-doctor.ts resolveScopeNames that doctor --artifacts audits every scope when --kyro-scope is absent
- Validation: check:blast-radius-isolation asserts recover.md never invokes prepare/apply/doctor --artifacts without --kyro-scope
- Validation: Sandbox: doctor --artifacts --kyro-scope demo exits 0 with an irreconcilable sibling scope present
- Files changed: `internal/skills/sprint-forge/assets/modes/recover.md`

**Verdict**: pass

---
### P2 — Trace relocation and read compatibility

> Move trace writes out of scopes/, keep previously recorded history readable in chronological order, and stop discovery from seeing leftover trace-only directories.

#### T2.1: Write trace as a sibling of scopes/

**Status**: done

**Description**: Point traceDir at KYRO_PROJECT_ROOT/trace/{scope} instead of ARTIFACT_ROOT/{scope}/trace, and update the check scripts and docs that hardcode the previous location.

**Evidence**:
- Summary: traceDir now returns KYRO_PROJECT_ROOT/trace/{scope}, a sibling of scopes/ rather than a child, and the four check scripts plus two docs that hardcoded the previous location were updated.
- Validation: Sandbox close-sprint wrote .agents/kyro/trace/demo/events.ndjson and created nothing new under .agents/kyro/scopes/
- Validation: check:trace, check:guardrails, check:maker-checker and check:status pass against the new location
- Validation: check:blast-radius-isolation asserts no trace write creates a scope-like directory
- Files changed: `src/cli/artifacts/paths.ts`, `scripts/check-trace.mjs`, `scripts/check-guardrails.mjs`, `scripts/check-maker-checker.mjs`, `scripts/check-status.mjs`, `docs/trace.md`, `docs/agent-adapters.md`

**Verdict**: pass

---
#### T2.2: Merge previous-location trace history chronologically

**Status**: done

**Description**: Read both the current and the previous trace locations, merge them by timestamp with a stable tie-break, apply tail after merging, and make trace --clear remove both files.

**Evidence**:
- Summary: readTrace reads both locations and merges them by timestamp with a stable tie-break (previous location first, then original line index), applying tail after the merge; trace --clear removes both files. An earlier concatenation-based version was corrected after review showed it mis-ordered a rollback or mixed-runtime write.
- Validation: Verified against this repo's real history: 31 pre-move events for integrity-recovery remain readable via kyro trace
- Validation: check:blast-radius-isolation asserts timestamp ordering when the previous location holds the newest event, and that --tail 1 keeps it
- Validation: check:blast-radius-isolation asserts identical timestamps render the same stable order across repeated reads
- Validation: Falsification: reverting the merge to plain concatenation makes the new assertions fail, so the gate is load-bearing
- Files changed: `src/cli/artifacts/paths.ts`, `src/cli/core/trace.ts`, `src/cli/commands/trace.ts`

**Verdict**: pass

---
#### T2.3: Ignore leftover trace-only directories in scope discovery

**Status**: done

**Description**: Make listScopeFolders skip any directory under scopes/ whose only entry is a trace folder, so installs upgraded from the previous layout stop carrying phantom scopes.

**Evidence**:
- Summary: listScopeFolders now skips any directory under scopes/ whose only entry is a trace folder, so installs upgraded from the previous layout stop surfacing phantom scopes as IRRECONCILABLE blockers.
- Validation: Sandbox: a scopes/ghost/trace-only directory no longer appears in repair integrity prepare --json output
- Validation: check:blast-radius-isolation asserts a trace-only leftover is never discovered as a scope
- Validation: check:scope-remediation (716 assertions) and check:repair-integrity (90 assertions) still pass, so real scope discovery is unaffected
- Files changed: `src/cli/artifacts/scopes.ts`

**Verdict**: pass

---
### P3 — Regression gate

> Prove the isolation holds end to end and fail the build if any startup surface reintroduces a global preflight.

#### T3.1: Add the blast-radius isolation gate

**Status**: done

**Description**: Add a portable check that statically asserts all four startup surfaces keep --kyro-scope and keep scope resolution ahead of prepare, and functionally asserts healthy/broken sibling isolation, preserved global scanning, phantom-scope suppression and trace merge ordering. Wire it into npm run check.

**Evidence**:
- Summary: Added scripts/check-blast-radius-isolation.mjs and wired it into npm run check. It combines static guards over the four startup surfaces with functional sandbox cases for sibling isolation, preserved global scanning, phantom-scope suppression and trace merge ordering.
- Validation: Falsification 1: dropping --kyro-scope from commands/forge.md makes the gate fail and name the file; restoring it makes it pass
- Validation: Falsification 2: reverting the trace merge to concatenation makes the ordering assertions fail
- Validation: Functional: healthy scope A closes with exit 0 while scope B is irreconcilable
- Validation: Functional: an explicit global prepare with no --kyro-scope still reports B as a blocker
- Validation: The gate runs inside npm run check, which passes end to end (exit 0)
- Files changed: `scripts/check-blast-radius-isolation.mjs`, `package.json`

**Verdict**: pass

---
#### T3.2: Record the change under Unreleased

**Status**: done

**Description**: Document both fixes in CHANGELOG.md under Unreleased without deciding or claiming a release version.

**Evidence**:
- Summary: Both fixes are documented under CHANGELOG.md Unreleased. No version field was changed and no release is claimed; 4.47.0 is already published and stays untouched.
- Validation: CHANGELOG.md Unreleased carries a Fixed section describing the integrity blast radius and the trace relocation
- Validation: check:versions still reports all versions matching 4.47.0, so no version was bumped
- Validation: Source comments say 'through 4.47.0' rather than naming an undecided next release
- Files changed: `CHANGELOG.md`

**Verdict**: pass

---

## Learnings

- The 4.47.0 hardening made repair safer but did not stop a local fault from escalating to a global block; safety of an operation and blast radius of a check are separate concerns.
- The startup contract was duplicated across four assets (router, skill, orchestrator, recover mode); fixing three of them still left the incident reproducible through the fourth.
- A path change that keeps a reader working on the happy upgrade path can still be wrong under rollback or mixed runtimes; merge by data, not by assumed deployment order.

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 2

- Decide the next version and move the Unreleased entry into it before publishing; 4.47.0 is already on npm.
- Consider promoting the scope-bound-by-default rule to a global convention via kyro rule add --global.
- Audit any remaining project-wide check that runs implicitly during routing for the same blast-radius shape.
