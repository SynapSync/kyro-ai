---
title: 'canonical-debt-contract-and-legacy-remediation — Sprint 1: Debt contract reconciliation and faithful fixtures'
date: '2026-08-10'
scope: 'canonical-debt-contract-and-legacy-remediation'
sprint: 1
slug: 'debt-contract-and-faithful-fixtures'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 1: Debt contract reconciliation and faithful fixtures

> Closed: 2026-08-10
> Outcome: shipped

## Objective

Freeze the canonical-versus-legacy debt contract and prove it against faithful original-incident fixtures before any new remediation writer is introduced.

## Definition of Done

- All seven tasks are done with concrete evidence and passing checker verdicts.
- The faithful corpus retains every original-incident sentinel and all production-backed contract mutations fail the focused harness.
- Kyro source, dist, projected runtime, and Lens observable behavior agree for the Sprint 1 debt contract scenarios.
- New debt writes remain exact canonical data and no read compatibility path authorizes mutation.
- Historical checkpoint, snapshot, narrative, and ledger commitment integrity remains fail-closed.
- Build, aggregate checks, focused cross-repository conformance, package dry-run, Doctor, and Analyze gates pass within the stated Sprint 1 boundary.

## Phases

### P1 — Faithful failure baseline

> Make the motivating artifact shapes permanent executable evidence before changing validation behavior.

#### T1.1: Create the faithful debt compatibility corpus

**Status**: done

**Description**: Add a minimized, non-secret golden corpus covering exact canonical debt, legacy-compatible debt, the live model-catalog D1 shape, the Sprint 1 checkpoint variant without note, the Sprint 2 checkpoint variant with note, and structurally unsupported debt. Record expected classification, canonical projection where defined, decisive legacy keys, and field-level diagnostics.

**Evidence**:
- Summary: Added the faithful debt compatibility corpus (6 cases: exact canonical, legacy-compatible with legacy-only keys, live model-catalog D1, Sprint 1 and Sprint 2 checkpoint variants, structurally unsupported) plus a checker enforcing classification/projection rules, incident sentinels, minimization, absence of absolute local paths, deterministic JSON bytes, and an 18-case in-memory mutation suite. Shapes were copied read-only from the Aliva checkout; only prose was truncated.
- Validation: node scripts/check-debt-contract-fixture.mjs -> 20 assertions passed (6 cases, 18 mutations)
- Validation: on-disk tamper probe (live D1 origin string -> 1) exits 1, corpus restored byte-identically
- Validation: git -C aliva-nutrilens-ai status: no change introduced by this task (read-only inspection)
- Files changed: `fixtures/debt-contract/golden.json`, `scripts/check-debt-contract-fixture.mjs`, `package.json`
- Notes: Registered as npm run check:debt-contract-fixture and wired into the aggregate check chain after check:debt.

**Verdict**: pass

---
#### T1.2: Lock the debt compatibility behavior matrix

**Status**: done

**Description**: Build a focused contract harness over the golden corpus that defines the four raw-input outcomes, exact canonical values for readable inputs, field-specific issues for remediable inputs, and unsupported failure behavior without relying on the current SprintFile validator.

**Evidence**:
- Summary: Added scripts/check-debt-contract.mjs, a focused harness that holds production classification to the golden corpus: four distinct outcomes, exact canonical projection in canonical key order for readable inputs, identity with the Lens projection, and exact field diagnostics for remediable ones. It never implements the classifier and never writes: fs mutators are stubbed to throw and watched sprint.json digests are compared before and after. Refined the corpus to the real Lens contract read from kyro-lens/src/data/parse.ts:570 — absent fields are legacy-compatible and normalizable (priority medium, targetSprint null, note composed from Source/Resolution/Disposition, origin from the sprint number), a present wrong-typed value such as the D1 string origin is remediation-required, and unusable id/title/status is unsupported. Corpus grew to 8 cases (added unsupported-missing-id and unsupported-bad-status for S4) and each case now records context.sprintNumber and the expected Lens accept/projection/failure.
- Validation: node scripts/check-debt-contract.mjs with no dist module -> exit 1: 'production classification behavior is missing'
- Validation: temporary wrong stub at dist/cli/core/debt-contract.js -> exit 1 naming the diverging case; stub removed
- Validation: node scripts/check-debt-contract-fixture.mjs -> 28 assertions passed (8 cases, 26 mutations)
- Validation: git status in kyro-lens and the Aliva checkout: no file written by this task (read-only inspection)
- Files changed: `scripts/check-debt-contract.mjs`, `fixtures/debt-contract/golden.json`, `package.json`, `scripts/check-debt-contract-fixture.mjs`
- Notes: check:debt-contract is registered standalone and stays red by design until T1.3 lands dist/cli/core/debt-contract.js; it will be wired into the aggregate check chain there. Contract expected from T1.3: assessRawDebt(raw,{sprintNumber}) -> {classification, canonical, legacyKeys, diagnostics{field,code,severity,authority,evidence,suggested,lensDefault}} plus CANONICAL_DEBT_KEYS and DEBT_CLASSIFICATION.

**Verdict**: pass

---
### P2 — Contract implementation

> Separate raw compatibility assessment from exact canonical debt validation and expose actionable Doctor behavior.

#### T1.3: Implement the raw debt assessment contract

**Status**: done

**Description**: Introduce a pure typed debt-input assessment that returns canonical, legacy-compatible, remediation-required, or unsupported with deterministic field issues and an exact canonical projection only when the raw input is safely readable.

**Evidence**:
- Summary: Implemented src/cli/artifacts/debt-contract.ts: assessRawDebt(unknown, {sprintNumber}) is pure, total and non-throwing, returning a closed discriminated union over canonical, legacy_compatible, remediation_required and unsupported. Unusable identity or status short-circuits to unsupported; a present wrong-typed value blocks and yields canonical:null; absence is compatible and normalizable, so readable inputs get an exact seven-field projection in canonical key order using the same defaults Lens applies. REVIEW FIX (R1 parity gap): 'present and wrong' now spans the typed legacy vocabulary, not only canonical keys. A non-string severity, source, resolution or disposition is blocking (LEGACY_VALUE_NOT_STRING), and an unmapped severity string is blocking (SEVERITY_NOT_RECOGNIZED) exactly while it is the sole source of a priority — with an explicit priority present the compatibility reader ignores it, and so does the classification. detail and addedSprint stay outside the vocabulary and constrain nothing. Every diagnostic names a stable field path, code, severity and authority: evidence-backed suggestions carry their evidence, operator judgments carry none (ADR-0004).
- Validation: npm run typecheck (strict) -> 0; npm run check (aggregate) -> exit 0
- Validation: 12 legacy-field vectors probed against the real Lens parser and against dist: identical accept/reject and identical projections, including severity blocker->critical, MAJOR->high, and unmapped severity ignored when priority is present
- Validation: npm run check:debt-contract -> 204 assertions over 14 corpus cases
- Validation: npm run check:debt-contract-fixture -> 35 assertions (14 cases, 33 mutations), including 7 new mutations binding the legacy-value semantics
- Validation: 20 adversarial inputs -> assessment returned, no throw
- Files changed: `src/cli/artifacts/debt-contract.ts`, `src/cli/types.ts`, `scripts/check-debt-contract.mjs`, `fixtures/debt-contract/golden.json`, `scripts/check-debt-contract-fixture.mjs`
- Notes: The review reported an unmapped severity string as an unconditional Lens rejection. Probing the real parser refined it: parse.ts guards that check with priority === undefined, so severity 'unknown' with a valid priority is accepted. Both branches are now golden vectors (legacy-severity-unrecognized and legacy-severity-unrecognized-with-priority) so the exact guard cannot drift silently.

**Verdict**: pass

---
#### T1.4: Separate exact canonical validation from compatibility reading

**Status**: done

**Description**: Refactor the debt validation boundary so new writes and canonical post-states require exactly the seven canonical keys while raw diagnostic readers can assess legacy input without weakening mutating commands or accepting hybrid output.

**Evidence**:
- Summary: Split the debt validation boundary. schema.ts now exposes CANONICAL_DEBT_KEY_VALUES and DEBT_VALIDATION_MODE; validateDebtItem rejects any key outside the seven canonical ones in exact mode, and validateSprintFile takes an optional { debt } mode defaulting to exact so every write path stays strict. Compatible mode keeps the previous required-field checks and tolerates legacy-only keys, so readers and future remediation preparation can still parse a legacy scope. debt.ts refuses add/resolve/escalate on a drifted scope before any write and now names what the live debt actually is via a read-only assessRawDebt reading, with the remedy stating explicitly that the reading is a diagnostic, not authorization. Inventoried all validateSprintFile callers: mutating commands, remediation transactions and certification plans keep the exact default; checkpointSchemaIssues stays exact by design because it reports schema currency of historical images separately from integrity, which never gates their commitment.
- Validation: npm run check (full aggregate chain) -> exit 0
- Validation: npm run check:debt -> extended: extra legacy key, missing canonical key, invalid literal and wrong type each refuse add/resolve/escalate, name the field path, and leave the scope byte-identical; debt add proven to emit exactly the seven canonical keys
- Validation: npm run check:sprint-doctor-v4 -> new cases for detail/resolution/addedSprint and a missing targetSprint report at the debt boundary
- Validation: npm run check:debt-contract -> 131 assertions, including exact rejecting a legacy-only key while compatible tolerates it and stays strictly more permissive
- Validation: manual sandbox with a legacy D1 plus a hybrid debt: all three mutations exit non-zero and the sprint.json sha256 is unchanged
- Files changed: `src/cli/artifacts/schema.ts`, `src/cli/commands/debt.ts`, `scripts/check-debt.mjs`, `scripts/check-sprint-doctor-v4.mjs`, `scripts/check-debt-contract.mjs`
- Notes: No caller was loosened to compatible mode in this task: nothing currently needs it, and switching a path silently would be exactly the permissiveness ADR-0001 forbids. The mode exists and is proven for the remediation preparation paths that land in later sprints.

**Verdict**: pass

---
#### T1.5: Report debt compatibility truthfully in Doctor

**Status**: done

**Description**: Wire the assessment contract into artifact Doctor so canonical live debt passes, legacy-compatible live debt is visibly non-canonical, remediation-required debt fails with actionable paths, unsupported debt fails closed, and historical schema notes never skip checkpoint artifact integrity verification.

**Evidence**:
- Summary: Doctor now reports the debt contract on its own check (scope/debt-contract), emitted before and independently of generic shape drift so it survives the early return: canonical passes, legacy-compatible warns as readable-but-not-canonical, remediation-required fails naming each present invalid field path, and unsupported fails closed. Remediation-required output also lists absent canonical fields explicitly as 'absent, readable by default, needs an explicit value', so an omission is never presented as unreadable while an operator decision is still required. No unshipped CLI verb appears in any remedy: they describe what must happen, not a command that does not exist yet.
- Validation: npm run check (full aggregate chain) -> exit 0
- Validation: npm run check:sprint-doctor-v4 -> four distinct diagnostics with exact field paths (canonical exit 0; legacy-compatible, remediation-required, unsupported exit 1) plus an anti-conflation case asserting a present invalid origin is never reported canonical or downgraded to legacy-compatible
- Validation: npm run check:verification-states -> 185 assertions; new case 6b drives both faithful historical D1 variants (Sprint 1 without note, Sprint 2 with note, legacy keys intact) through close-sprint: schema notes retained, narrative=ok on intact commitments, narrative=conflict and non-zero exit after byte tampering
- Validation: manual sandbox with canonical, legacy-compatible, remediation-required and unsupported debt in one scope -> three distinct debt-contract lines, exit 1
- Files changed: `src/cli/commands/artifact-doctor.ts`, `scripts/check-sprint-doctor-v4.mjs`, `scripts/check-verification-states.mjs`, `scripts/check-cli-bundle-assets.mjs`
- Notes: check-cli-bundle-assets pins the verification harness assertion count; updated 162 -> 185 so the projected-runtime coverage gate keeps matching the harness it drives. Case 6b reads the shapes from fixtures/debt-contract/golden.json and asserts the two historical variants are still there, so cleaning the corpus breaks the release gate instead of silently weakening it.

**Verdict**: pass

---
### P3 — Cross-repository and runtime proof

> Prove that the frozen contract matches Lens observable behavior and survives build and runtime projection.

#### T1.6: Verify the golden debt corpus against Lens

**Status**: done

**Description**: Add an explicit cross-repository conformance command that runs the golden raw-debt cases through the current Lens parser and compares parse success, rejection paths, and canonical projections with the Kyro contract without modifying Lens.

**Evidence**:
- Summary: Added scripts/check-lens-debt-contract.mjs plus check:lens-debt-contract: an opt-in cross-repository gate that runs every golden case through the real Lens parser instead of reimplementing normalizeDebt, loading src/data/parse.ts in memory through the Lens checkout's own Vite server and calling buildWorkspace per case. It compares acceptance, rejection path and canonical projection against the corpus and asserts the observed Lens projection equals the Kyro canonical projection. REVIEW FIX: the corpus now carries six additional legacy-vocabulary vectors, so the gate covers the whole observable Lens surface rather than the canonical keys alone — non-string severity/source/resolution/disposition, an unmapped severity with and without an explicit priority, and a valid severity that supplies the absent priority.
- Validation: KYRO_LENS_ROOT=<lens> node scripts/check-lens-debt-contract.mjs -> 10 assertions passed; 14 golden cases conform to the live Lens parser
- Validation: live Lens confirms each new vector: severity 7 / source 7 / resolution 7 / disposition 7 and severity 'unknown' without priority are rejected at their own field path; severity 'blocker' projects priority critical and severity 'unknown' with priority low is accepted unchanged
- Validation: no KYRO_LENS_ROOT -> exit 2; bad root -> exit 2; stale corpus vs the Kyro contract -> exit 2
- Validation: 6 divergence mutations still fail closed; git -C lens status --porcelain identical before and after
- Files changed: `scripts/check-lens-debt-contract.mjs`, `fixtures/debt-contract/golden.json`, `package.json`
- Notes: Stays opt-in like check:lens-remediation-fixture: it needs a Lens checkout with installed dependencies. The base sprint.json is Kyro's own close-sprint-happy fixture, so each run also proves Kyro canonical output is Lens-readable.

**Verdict**: pass

---
#### T1.7: Certify contract and projected-runtime parity

**Status**: done

**Description**: Wire the focused contract, fixture, Doctor, mutation, and projected-runtime checks into the appropriate aggregate gates and prove existing remediation, debt, checkpoint, build, and packaging behavior remains intact.

**Evidence**:
- Summary: Wired the contract into the aggregate and projected-runtime gates. check:debt-contract and check:debt-contract-fixture run inside npm run check; check-debt-contract.mjs honours KYRO_DIST_UNDER_TEST, and check-cli-bundle-assets drives the same faithful corpus through the isolated projected runtime, asserting the full result rather than a bare exit code. REVIEW FIX: the projected-runtime coverage assertion was re-pinned to the extended corpus (204 assertions over 14 cases), so a runtime that classified only the original eight cases would fail the gate instead of passing it. Existing v1/v2 remediation, recertification, checkpoint integrity and packaging suites were re-run unchanged: none were weakened or deleted to fit the new contract.
- Validation: npm run build -> 0; npm run check (aggregate) -> exit 0
- Validation: npm run check:cli-bundle-assets -> projected runtime classifies the extended corpus: 204 assertions over 14 cases, identical to source dist
- Validation: KYRO_LENS_ROOT=<lens> check:lens-debt-contract -> 14 golden cases conform to the live Lens parser
- Validation: check:scope-remediation 307, check:verification-states 185, check:compact-remediation-witness 9, check:replay-witness 5, check:lossless-checkpoints, check:maker-checker -> all pass unchanged
- Validation: npm pack --dry-run -> 0 with the corpus and both checkers in the tarball
- Validation: node dist/cli.js doctor --artifacts -> exit 0; analyze -> 6 finding(s) CRITICAL=0 HIGH=0 MEDIUM=6, all of them the explicit R3-R7/R9 future-sprint scenario gaps
- Files changed: `package.json`, `scripts/check-cli-bundle-assets.mjs`, `scripts/check-debt-contract.mjs`
- Notes: The six MEDIUM analyze findings remain the planned uncovered requirements for later sprints, left explicit rather than papered over with fabricated scenarios. Coverage counts are pinned deliberately in check-cli-bundle-assets so growing the corpus without re-proving the installed runtime breaks the gate.

**Verdict**: pass

---

## Learnings

- Compatibility input and canonical output must remain separate: every Lens-interpreted legacy field needs shared conformance vectors, including conditional defaults.

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 2

- Keep Sprint 2 limited to the typed operation schema and read-only preparation; do not introduce apply or mutate immutable history before the transaction and replay gates in Sprint 3.
