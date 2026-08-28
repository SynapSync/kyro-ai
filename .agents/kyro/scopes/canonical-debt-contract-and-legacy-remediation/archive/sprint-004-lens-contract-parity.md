---
title: 'canonical-debt-contract-and-legacy-remediation — Sprint 4: Lens contract parity and provenance'
date: '2026-08-10'
scope: 'canonical-debt-contract-and-legacy-remediation'
sprint: 4
slug: 'lens-contract-parity'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 4: Lens contract parity and provenance

> Closed: 2026-08-10
> Outcome: shipped

## Objective

Make Kyro Lens an independent, read-only verifier and renderer of v1, v2, v3, and mixed remediation chains, including canonicalization provenance, interrupted publication, and chain-head-bound recertification.

## Definition of Done

- All Sprint 4 tasks have CLI-recorded evidence and independent pass verdicts.
- Lens independently derives v1, v2, v3, and mixed remediation and recertification state from artifact bytes, anchors, and bounded read-only discovery.
- Valid v3 canonicalization provenance is visible, while forged, unknown, PREPARED, and unanchored variants fail closed without stale-state fallback.
- Lens build and scoped contract, resolver, and Overview tests pass with mutation evidence for the new guards.
- No Kyro writer, immutable historical artifact, original Aliva checkout, package release, or documentation claim is changed by this sprint.

## Phases

### P1 — Versioned Lens protocol ingestion

> Replace Lens's v1-only remediation model with an explicit, fail-closed reader for every Kyro remediation revision already emitted.

#### T4.1: Model and parse versioned remediation records

**Status**: done

**Description**: Extend Lens domain types and parsing so remediation records are a discriminated union for v1 snapshot records and v2/v3 compact-witness records. Bind debt.origin.set to revisions 1/2/3 and debt.canonicalize only to v3; validate its complete debt-collection precondition, exact seven-key after-image, retired legacy keys, and closed key sets. Preserve strict parsing of C-NNN records and reject unknown versions, version-operation mismatches, malformed commitments, or extra keys as unsupported rather than coercing them.

**Evidence**:
- Summary: Lens now models remediation records as a discriminated union over schemaVersion 1/2/3 and parses them fail-closed with field-level refusals. types.ts adds REMEDIATION_SCHEMA_VERSIONS, the closed operation registry bound per revision (debt.origin.set at 1/2/3, debt.canonicalize only at 3), CanonicalizeDebtOperation with its seven-key CanonicalDebtAfterImage and retiredKeys, the compact operations-replay witness, CompactScopeRemediation and the ScopeRemediation union. parse.ts replaces the boolean v1 predicate with issue-collecting validators: each revision is held to its own replay witness (v1 snapshot, v2/v3 witness), an operation kind outside the revision registry is refused rather than reinterpreted, an unknown schemaVersion is refused outright, and a canonicalization must present a whole-debt-collection SHA-256 precondition, an exact seven-key after-image, named retired keys that are never canonical keys, and resolves entries referencing declared issue ids. C-NNN parsing gained the same field-level strictness over id, commitments, evidence sources, verdict outcome and unknown keys. The resolver was widened to the union so the checkout still typechecks; its semantics remain T4.2 work.
- Validation: pnpm run typecheck (tsc -b): exit 0
- Validation: vitest src/data/parse.test.ts + validate.test.ts + remediation-summary.test.ts + remediation-real-contract.test.ts: 122 passed, 0 failed
- Validation: Full Lens suite: 843 passed, 9 failed — all 9 in assistant-model-select.test.tsx (localStorage.clear is not a function), reproduced identically on the stashed pre-change baseline, unrelated to remediation parsing
- Validation: Write-path audit: grep for writeFile/createWritable/removeEntry across src finds no production write path; the only hit is checkpoint-summary.test.ts
- Files changed: `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/domain/types.ts`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/data/parse.ts`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/data/parse.test.ts`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/data/remediation-summary.ts`
- Notes: Existing v1 remediation/recertification tests in validate.test.ts and the real-contract fixture test still pass unchanged. The 9 pre-existing Lens failures are recorded as discovered debt, not introduced here.

**Verdict**: pass

---
### P2 — Independent provenance verification

> Derive Lens provenance state from bytes, anchors, and replay semantics rather than from Kyro's presentation labels.

#### T4.2: Verify versioned chains, interrupted records, and certificates

**Status**: done

**Description**: Refactor the Lens provenance resolver into a shared semantic evaluator for versioned remediation chains. It must recompute canonical commitments, validate canonical paths and anchor ordering, verify the declared result against the live business-state projection and version-specific replay witness, and bind C-NNN to the current remediation head and evidence. When directory listing is available, compare archive/remediations and archive/certifications to live anchors so an unanchored R-NNN or C-NNN is detected; when listing is unavailable, report that the existence check is unavailable rather than claiming it passed. A valid PREPARED record (record persisted but anchor absent) and a planted record both fail closed as diverged, with actionable detail.

**Evidence**:
- Summary: Review fix: the unanchored-artifact classifier now establishes identity before continuity. Calling a record PREPARED is an instruction to an operator to resume it, and the previous version derived that label from base continuity alone — so a structurally valid R-999 from another scope, dropped in as remediation-002.json, could be labelled resumable whenever its base happened to match this chain. classifyUnanchoredRemediation now requires the record's own id to equal the filename-derived id (mismatch: CORRUPT, the filename and contents disagree), its scope to equal the live scope (mismatch: DIVERGED, naming the foreign scope), and its version-specific replay witness to verify, before continuity is even considered. classifyUnanchoredCertification enforces the same rule over certificationId and identity.scope. Both paths keep failing closed inside the existing vocabulary; only the reason changes, and no case that previously reported PREPARED on genuine bytes changed its answer.
- Validation: Node v22.22.1 (within engines >=20): pnpm run typecheck exit 0; pnpm run build built in 2.18s
- Validation: node scripts/check-guard-mutations.mjs: exit 0 — 16 assertions over 4 guards; a new 'unanchored artifact identity' guard disables the id check and requires the probe to flip from CORRUPT to PREPARED
- Validation: Focused suites (remediation-real-contract, remediation-summary, parse, overview): 83 passed, 0 failed
- Validation: Three new negative cases over the real Kyro-emitted PREPARED bytes: a record that DOES continue the live chain but declares id R-999 -> CORRUPT and never PREPARED; the same bytes declaring another scope -> DIVERGED naming it; a planted certificate whose id disagrees with its filename, and one declaring a foreign scope -> CORRUPT/DIVERGED, never PREPARED
- Validation: git diff --check: clean
- Files changed: `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/data/remediation-summary.ts`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/data/remediation-real-contract.test.ts`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/scripts/check-guard-mutations.mjs`
- Notes: The certificate case initially passed for the wrong reason: emptying certifications[] made the real C-001 unanchored too, and it was classified first. The fixture now keeps C-001 anchored so the planted file is the only artifact under test.

**Verdict**: pass

---
### P3 — Provenance visibility and cross-repository gate

> Expose the independently derived state and make Kyro-generated artifact fixtures the executable contract between repositories.

#### T4.3: Render canonicalization provenance without stale fallback

**Status**: done

**Description**: Update the Lens Overview provenance card and its shell data flow to pass the available directory lister into the resolver. Render the derived remediation/recertification state, record and certificate ids, reasons, issue codes, operation kind, exact canonicalization after-image, and retired legacy keys. Render diverged, unsupported, or unavailable verification as an explicit warning with the evaluator's detail; do not display a healthy remediation badge or hide the card because an anchor is missing.

**Evidence**:
- Summary: The Overview provenance card now renders the evaluator's independent result and the shell feeds it the directory lister. listDirectory already flowed from the readers through ingestion into KyroLens; it is now forwarded to OverviewView and into the resolver's reader, so the unanchored scan actually runs in the app. The card was restructured around three defects: it no longer skips verification when sprint.remediations is empty (which is exactly how an unanchored record used to stay invisible), it no longer treats a derived remediated/recertified state as healthy unless the existence scan was also verified, and it renders an explicit amber warning carrying the evaluator's own detail when the scan could not run. It is hidden only when the scope has no provenance at all and Lens proved there is none. Rendering adds the record id and protocol revision, the reason, issue codes, operation kinds, a dedicated canonicalization block with the exact seven-key after-image and the named retired legacy keys, and the certificate id, checker and outcome. data-provenance-state and the new data-existence-check expose both dimensions.
- Validation: pnpm run typecheck (tsc -b): exit 0
- Validation: pnpm run build (tsc -b && vite build): built successfully
- Validation: vitest overview.test.tsx: 21 passed, 0 failed (4 new canonicalization-provenance cases)
- Validation: vitest src/data + src/components: 747 passed, 9 failed — all 9 are the pre-existing localStorage environment failures in assistant-model-select.test.tsx and sprint-board.test.tsx, reproduced on the unmodified baseline and untouched by this task
- Validation: UI assertions: after-image and retired keys rendered with protocol v3; planted unanchored R-002 renders diverged and drops the canonicalization block; a record with no anchor keeps the card visible instead of hiding it; a reader without listDirectory yields data-existence-check=unavailable, the amber border, and the scan-unavailable warning
- Files changed: `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/components/kyro/views/overview.tsx`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/components/kyro/views/overview.test.tsx`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/components/kyro/kyro-lens.tsx`
- Notes: Lens stays read-only: the card only reads and renders, and offers no apply, repair or resume control for a PREPARED record — it names the condition and says Kyro must resolve it.

**Verdict**: pass

---
#### T4.4: Gate Lens against Kyro-emitted v3 provenance fixtures

**Status**: done

**Description**: Extend the checked-in real-contract fixture and Lens tests with Kyro-emitted v3 canonicalization and recertification bytes plus targeted immutable mutations. Run the Lens parser, independent resolver, and Overview tests against the same fixture surface; prove the tests bind by changing one version guard, one chain-head binding, and one unanchored/PREPARED guard in a temporary mutation run. Do not modify the original Aliva checkout or claim package, installed-runtime, documentation, or publication certification; those remain Sprint 5 work.

**Evidence**:
- Summary: Gate extended for the review fix and re-measured on a supported Node. The mutation gate gained a fourth guard, 'unanchored artifact identity', which disables the filename-vs-record id comparison and requires the probe to stop reporting CORRUPT: 16 assertions over 4 guards, every source verified restored. remediation-real-contract.test.ts is now 12 cases, three of them the new identity/scope negatives built on the real Kyro-emitted PREPARED bytes rather than on synthetic imitations. The previously reported test instability was re-measured and re-attributed: it was a Node version artifact, not a Lens defect.
- Validation: Node v22.22.1: pnpm run typecheck exit 0; pnpm run build built; check:guard-mutations exit 0 (16 assertions / 4 guards); focused suites 83 passed / 0 failed
- Validation: Full suite on Node v22.22.1: pre-change baseline 844 passed / 0 failed; with Sprint 4, three consecutive runs gave 878 passed, then 877 passed / 1 failed twice — always assistant-chat 'clears only the active chat draft', which passes in isolation (102/102)
- Validation: The earlier report of 9-10 deterministic failures was an artifact of running on Node v25.2.1, whose native localStorage shadows the jsdom global and breaks localStorage.clear. debt-1 was resolved as misdiagnosed; debt-2 was deferred to sprint 5 with the measured intermittency, matching the reviewer's clean run
- Files changed: `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/scripts/check-guard-mutations.mjs`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/data/remediation-real-contract.test.ts`
- Notes: Claim remains Lens parity only. R8/R9 — packaged install, projected runtime, the original-scope probe, release documentation and publication — remain Sprint 5. The original Aliva checkout was never read or written.

**Verdict**: pass

---

## Learnings

- An artifact can be resumable only after its filename identity, declared scope, witness, continuity, and commitment evidence agree; continuity alone is not operator-safe.
- Test evidence must name the Node runtime: Node v25 native localStorage changed the baseline, while supported Node v22 isolates the real assistant-chat ordering flake.

## Resolved Debt

- **debt-1**: Lens assistant-model-select suite fails on localStorage.clear in the current vitest/jsdom environment

## Recommendations for Sprint 5

- Sprint 5 must resolve the deferred Lens assistant draft-store isolation failure under a pinned supported Node runtime before claiming a green release suite.
- Sprint 5 must run the faithful original incident only in a temporary copy through source, isolated package, installed or projected runtime, Doctor, recertification, and Lens without touching Aliva.
- Sprint 5 must publish R9 operator documentation with the 4.43.5 origin-only limitation, upgrade order, and exact evidence boundary.
