---
title: 'canonical-debt-contract-and-legacy-remediation — Sprint 3: Chain verification and recertification integrity'
date: '2026-08-10'
scope: 'canonical-debt-contract-and-legacy-remediation'
sprint: 3
slug: 'chain-verification-and-recertification'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 3: Chain verification and recertification integrity

> Closed: 2026-08-10
> Outcome: shipped

## Objective

Atomically apply and resume typed debt canonicalizations, then verify and recertify v1, v2, and v3 remediation chains without weakening immutable historical integrity.

## Definition of Done

- A complete debt.canonicalize manifest applies and resumes atomically under the state-writer lock, with one append-only remediation record and exact seven-key live debt.
- Doctor, status, and replay verify v1, v2, v3, and mixed remediation chains without weakening immutable checkpoint, snapshot, narrative, ledger, or tamper checks.
- A C-NNN independently binds verified evidence to the exact canonicalization chain head; stale or forged claims fail closed and remain visible as non-certified.
- Kyro source and projected-runtime gates pass without modifying Lens, the original Aliva checkout, package publication state, or immutable scope history.

## Phases

### P1 — Atomic canonicalization transaction

> Turn the reviewed v3 manifest into one durable, append-only remediation only when the complete observed state still authorizes it.

#### T3.1: Apply and resume debt.canonicalize atomically

**Status**: done

**Description**: Extend the existing remediation transaction so a valid protocol-v3 debt.canonicalize manifest is re-planned inside the state-writer lock, replaces exactly its targeted live debt with the validated seven-key after-image, appends one R-NNN record and anchor, and preserves all other state and immutable history. Support deterministic PREPARED resume using the same record identity, createdAt, commitment, and after-image; reject stale base state, whole-debt digest drift, malformed output, interruption, or post-write mismatch without a competing record or partial live mutation.

**Evidence**:
- Summary: debt.canonicalize now applies atomically through the existing remediation transaction. The executor replaces exactly its targeted debt with the seven-key after-image rebuilt in canonical key order, after re-verifying the whole-debt collection precondition, preserved title/status and full retiredKeys accounting inside the state-writer lock. A batch is recorded at the lowest revision that admits its operations (requiredRemediationRevision), so origin-only remediations still emit byte-identical v2 records and only a canonicalization produces v3. transaction.ts needed no change: publish/compare-and-swap/read-back and PREPARED resume were already operation-agnostic, which is the evidence that the operation was modelled correctly in Sprint 2.
- Validation: npm run build: exit 0
- Validation: npm run check (aggregate): exit 0
- Validation: npm run check:scope-remediation: 617 assertions passed (456 at sprint start), including the new T3.1 apply/resume matrix
- Validation: npm run check:verification-states: 185 assertions passed, unchanged
- Validation: npm run check:replay-witness: 5 assertions; check:compact-remediation-witness: 9 assertions, both unchanged
- Validation: npm run check:mcp: passes against the regenerated 13-tool golden catalog
- Files changed: `src/cli/remediation/protocol.ts`, `src/cli/remediation/plan.ts`, `src/cli/commands/remediate.ts`, `src/cli/remediation/canonicalize-surface.ts`, `src/cli/mcp/tool-catalog.ts`, `fixtures/mcp/tool-catalog.golden.json`, `scripts/check-scope-remediation.mjs`
- Notes: Coverage: happy path (one append-only v3 R-001, exact seven-key live record in canonical order, retired detail/resolution/addedSprint, unrelated debt D2 byte-identical, archive bytes unchanged, doctor APPLIED); deterministic resume from a replanted PREPARED record with no duplicate R-NNN and byte-identical record; 11 negative mutations (stale collection digest, stale base, forged head, forged identity, renamed title, moved lifecycle, hybrid after-image, unaccounted legacy key, unknown debt id, unknown revision, canonicalization smuggled into v1) each asserting zero mutation of archive, live debt, anchors and the record directory; unconfirmed apply stops at CONFIRMATION_REQUIRED; the origin-only flow still records v2. Finding for T3.2: doctor walks anchors only, so a PREPARED record with no anchor yet is invisible to it — the PREPARED state is observable through remediate preview. Deliberate scope note: the read-only prepare/preview help and MCP descriptions asserting this runtime cannot apply a canonicalization were corrected, since T3.1 makes those statements false.

**Verdict**: pass

---
### P2 — Version-aware chain verification

> Make replay and artifact reporting prove the corrected live state while retaining the original checkpoint as historical evidence.

#### T3.2: Replay v1, v2, v3, and mixed remediation chains in Doctor and status

**Status**: done

**Description**: Extend replay and verification-state derivation to execute the closed v3 canonicalization operation through the same validated executor used by apply, while preserving v1 snapshots and v2 compact witnesses. Make Doctor and status distinguish historical, remediated, recertified, diverged, and unsupported states with integrity checks for every checkpoint, remediation record, anchor, commitment, order, and result digest; historical schema compatibility notes must never bypass snapshot or narrative inspection.

**Evidence**:
- Summary: REVIEW FIX. The critical finding is correct and was mine: I detected unanchored remediation records in doctor's chain lens but never wired that into deriveScopeVerificationState, which is what status consumes AND what doctor's own verification check consumes. One doctor run therefore emitted 'R-002: DIVERGED' and 'verification: remediated' together, and status reported a healthy scope over planted evidence. The single-derivation guarantee was not actually single. Fixed by extracting evaluateUnanchoredRemediationRecords() as the shared semantic evaluation: doctor's chain lens now only RENDERS its findings, and the verification derivation consults the same function before it may return any healthy state. Both readers now agree on the planted record, the interrupted publish, and the healthy baseline. Original T3.2 scope unchanged: replay of v1/v2/v3/mixed chains through each record's own revision, and advanceReplayState consulting a snapshot witness only for v1.
- Validation: npm run build: exit 0
- Validation: npm run check (aggregate): exit 0
- Validation: npm run check:verification-states: 315 assertions passed (283 before the fix)
- Validation: npm run check:scope-remediation: 716 assertions passed
- Validation: npm run check:canonicalization-gate: 120 assertions, 8 guards proven load-bearing (was 7)
- Validation: npm run check:replay-witness: 5; check:mcp: exit 0; check:cli-bundle-assets: exit 0 (projected-runtime pin 283 -> 315)
- Validation: node dist/cli.js doctor --artifacts: exit 0, 23 PASS, zero FAIL and zero WARN
- Validation: node dist/cli.js analyze: exit 0, CRITICAL=0 HIGH=0 MEDIUM=2 (R7 Lens, R9 docs only)
- Validation: git diff --check: exit 0
- Validation: Reviewer scenario reproduced directly: valid R-001 plus planted unanchored R-002 now gives doctor exit 1 / verification: diverged AND status Verification: diverged naming R-002
- Files changed: `src/cli/remediation/plan.ts`, `scripts/check-verification-states.mjs`, `scripts/check-canonicalization-gate.mjs`, `scripts/check-cli-bundle-assets.mjs`, `scripts/check-scope-remediation.mjs`
- Notes: Three cross-reader regressions added, each asserting doctor and status agree rather than asserting either verdict alone, since the contradiction was the defect: (1) a planted record that does not continue the chain, both diverged, doctor exit 1, reason actionable and status naming R-002; (2) a genuine interrupted publish that DOES continue the chain, both diverged, named as PREPARED so it reads as an unresolved transaction rather than tampering, and explicitly never as remediated or recertified; (3) a certified scope that loses its certification the moment an unanchored record appears. Each starts from a baseline where both readers agree the scope is healthy, so the assertion cannot pass for an unrelated reason. Deliberate design decision for review: an interrupted publish is reported as diverged rather than through a new sixth verification state. Adding a state would change the contract Kyro Lens reads (R7) while Lens is still Sprint 4's to update, so this fails closed inside the existing vocabulary and carries PREPARED in the detail string to stay actionable and distinguishable from tampering. If a dedicated state is wanted, it belongs in Sprint 4 alongside the Lens change. Mutation gate extended per the review: the doctor mutation was retargeted to the shared evaluator, and a new eighth guard proves the status path is load-bearing by removing the derivation's consultation and requiring status to stop saying diverged. Detection in the gate is now a predicate over the whole result rather than an exit code, because status exits 0 either way and the only honest question to ask it is what it said.

**Verdict**: pass

---
### P3 — Recertification integrity gate

> Bind an independently reverified certification to the exact canonicalization chain head and preserve visible failures.

#### T3.3: Recertify a verified canonicalization chain

**Status**: done

**Description**: Extend certification planning and transaction validation so a C-NNN can be prepared and applied only for a verified v3 or mixed remediation head. Re-derive every evidence digest under the writer lock, bind the certificate to the exact current remediation commitment, append only the certification anchor, and resume a PREPARED certificate deterministically. A new remediation, changed evidence, invalid verdict, or failed chain must prevent recertification and leave no passing certificate claim.

**Evidence**:
- Summary: Recertification of a v3 canonicalization head is proven end to end. No production change was required, and that is the finding rather than a shortcut: certification binds to the chain HEAD COMMITMENT and to deriveScopeVerificationState, never to what the head contains, so it was already revision-agnostic by construction. That was a claim until this task; it is now a checked property over a real v3 head driven through the real kyro recertify. Coverage was added where the certification vocabulary already lives (check-verification-states.mjs) so both readers keep being asserted on the same fixture.
- Validation: npm run build: exit 0
- Validation: npm run check (aggregate): exit 0
- Validation: npm run check:verification-states: 283 assertions passed (185 at sprint start)
- Validation: npm run check:scope-remediation: 716 assertions passed, unchanged by this task
- Validation: npm run check:cli-bundle-assets: exit 0 with the projected-runtime verification pin updated 185 -> 283
- Files changed: `scripts/check-verification-states.mjs`, `scripts/check-cli-bundle-assets.mjs`
- Notes: Coverage added: a v3 head certifies to exactly one C-001 binding the v3 chain-head commitment and the live business digest, with doctor and status both reporting recertified and every pre-existing archive byte (checkpoint, snapshot, narrative, and the v3 remediation record) unchanged; a later origin-only remediation on top drops the certificate back to remediated while KEEPING the superseded C-001 record as immutable evidence, and recertifying the new head appends C-002 rather than reviving C-001; empty evidence, failing verdict and stale chain head each refuse with no record, no anchor and no disturbed history, leaving the scope merely remediated; evidence observed against a different head is refused even though the artifact still hashes correctly, with the current head named in the refusal; an interrupted certification resumes as the same C-001 byte-for-byte with no C-002; and the MCP recertify_scope surface refuses the same manifest for the same stated reason as the CLI without writing a record. Two behaviours recorded as observed rather than changed: MCP signals refusal as a tool error result (isError) rather than by throwing, so parity is asserted on outcome and reason, not transport; and an origin-only remediation becomes possible again only AFTER the canonicalization, since strict projection is whole-file (T3.2).

**Verdict**: pass

---
#### T3.4: Certify the transaction and verification boundary

**Status**: done

**Description**: Consolidate focused source and projected-runtime evidence for the full prepare, preview, apply, resume, replay, Doctor, status, and recertify flow on the faithful D1-shaped fixture. Use mutation-oriented negative cases to prove the new checks bind to full-debt state, immutable artifacts, chain head, and evidence rather than merely exercising happy paths. Keep the external Lens and packaged original-scope probe for their dedicated later sprints.

**Evidence**:
- Summary: REVIEW FIX. The gate did not cover the Doctor/status contradiction for unanchored R-NNN, which is why every suite passed over a real defect. Extended per the review: guard detection is now a predicate over the whole probe result instead of an exit code, because status reports a verification state on stdout and exits 0 either way — asking it for an exit code could never have caught this. The doctor-side mutation was retargeted from the rendering wrapper to the shared evaluator both readers consume, and an eighth guard was added that removes the verification derivation's consultation of it and requires status to stop reporting diverged. 8 guards, 120 assertions. The complete D1 flow transcript is unchanged and still passes.
- Validation: npm run build: exit 0
- Validation: npm run check (aggregate): exit 0
- Validation: npm run check:canonicalization-gate: 120 assertions, 8 guards proven load-bearing (was 104 and 7)
- Validation: npm run check:scope-remediation: 716; check:verification-states: 315; check:replay-witness: 5 — all exit 0
- Validation: npm run check:mcp: exit 0; npm run check:cli-bundle-assets: exit 0
- Validation: node dist/cli.js doctor --artifacts: exit 0, 23 PASS, zero FAIL and zero WARN
- Validation: node dist/cli.js analyze: exit 0, CRITICAL=0 HIGH=0 MEDIUM=2 (R7 Lens, R9 docs only)
- Validation: git diff --check: exit 0
- Files changed: `scripts/check-canonicalization-gate.mjs`, `scripts/check-cli-bundle-assets.mjs`
- Notes: Guards now proven load-bearing: whole-debt collection precondition; identity and lifecycle preservation; retired-key accounting; exact seven-key after-image; protocol revision binding; compact-revision replay; unanchored-record evaluation (shared by both readers); and unanchored records reaching the verification state (the status path). The eighth guard is the direct answer to the review: with the derivation's consultation removed, status stops saying diverged over a planted record, which is precisely the reported defect reproduced mechanically and now prevented from returning. The gate proved its own worth during this fix — when the shared evaluator was extracted, the old doctor-lens mutation stopped changing doctor's answer (the verification check still caught it) and the harness reported 'disabling the guard changed nothing' rather than passing quietly. Scope boundary unchanged: no Lens-parity, packaged-install, original-Aliva-probe, documentation or publication claim; R7 and R9 remain Sprints 4 and 5. Neither the Lens nor the Aliva checkout was read or written.

**Verdict**: pass

---

## Learnings

- Verification readers must share one semantic chain evaluation; rendering-only checks can leave Doctor and status contradictory.
- A PREPARED remediation is not healthy state: retain its actionable detail but fail closed in the existing verification vocabulary until Lens evolves.

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 4

- Sprint 4 must independently verify v3 canonicalization provenance, unanchored or PREPARED records, and chain-head-bound recertification in Lens.
- Keep Lens read-only and mirror Kyro fail-closed chain semantics without trusting Kyro status labels.
