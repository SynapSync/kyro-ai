---
title: 'append-only-scope-remediation — Sprint 3: Lens remediation ingestion'
date: '2026-08-09'
scope: 'append-only-scope-remediation'
sprint: 3
slug: 'lens-remediation-ingestion'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 3: Lens remediation ingestion

> Closed: 2026-08-09
> Outcome: shipped

## Objective

Make remediation and recertification provenance verifiable and actionable in Kyro Lens while closing the replay-integrity gap that Lens will consume.

## Definition of Done

- debt-2 is resolved with a replay-integrity regression that fails on a tampered intermediate snapshot.
- Lens strictly parses, verifies, and presents v1 remediation and recertification provenance without applying or repairing artifacts.
- A real Kyro AI fixture proves valid remediated and recertified states in Lens, while invalid and unsupported chains fail closed.
- Isolated projected-runtime parity, Kyro AI checks, Lens checks, and artifact doctor pass; debt-3 remains explicitly deferred.
- Every task has CLI-recorded evidence and an independent pass verdict.

## Phases

### P1 — Replay integrity

> Close the unsafe snapshot handoff before a reader consumes the protocol.

#### T3.1: Validate every replay snapshot before reuse

**Status**: done

**Description**: Harden multi-record remediation replay so a non-final record.result.snapshot is never used as the next replay base unless its canonical business-state digest equals record.result.stateSha256.

**Evidence**:
- Summary: Validated every non-final remediation snapshot as a strict SprintFile and verified its canonical business-state digest before replay reuse.
- Validation: npm run build (pass)
- Validation: npm run check:scope-remediation (292 assertions passed)
- Validation: npm run check:verification-states (143 assertions passed)
- Validation: Independent certification: npm run check complete (pass)
- Validation: doctor --artifacts --kyro-scope append-only-scope-remediation (pass)
- Files changed: `src/cli/remediation/plan.ts`, `src/cli/remediation/protocol.ts`, `scripts/check-scope-remediation.mjs`, `scripts/check-verification-states.mjs`
- Notes: Independent certification verified the new regression fails without the replay guard. The protocol comment now points to that guardrail; the original contract intentionally preserves the snapshot as archival data.

**Verdict**: pass

---
### P2 — Lens protocol reader

> Give Lens a strict, read-only interpretation of the versioned remediation and certification protocol.

#### T3.2: Model and parse remediation protocol shapes in Lens

**Status**: done

**Description**: Add strongly typed Lens representations and fail-closed parsing for remediation anchors, R-NNN records, certification anchors, and C-NNN records without weakening legacy sprint compatibility.

**Evidence**:
- Summary: Added strict v1 Lens types and parsers for remediation and recertification anchors and immutable records.
- Validation: pnpm run typecheck (pass)
- Validation: pnpm exec vitest run src/data/validate.test.ts (82 tests passed)
- Files changed: `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/domain/types.ts`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/data/parse.ts`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/data/validate.test.ts`
- Notes: Legacy scopes remain compatible when optional provenance anchors are absent; malformed v1 anchors and records are rejected fail-closed.

**Verdict**: pass

---
#### T3.3: Resolve and verify anchored provenance in Lens

**Status**: done

**Description**: Implement the read-only resolver that follows each remediation anchor through remediations[].path and validates its identity, scope containment, commitment, ordering, certificate chain-head binding, and evidence references before producing a Lens provenance summary.

**Evidence**:
- Summary: Implemented Lens read-only v1 provenance verification with canonical SHA-256 commitments, ordered remediation chains, certification/evidence validation, and bounded derived corpus summaries.
- Validation: pnpm exec tsc --noEmit (pass)
- Validation: pnpm exec vitest run src/data/validate.test.ts src/data/remediation-summary.test.ts src/data/ai-scope-corpus.test.ts src/components/kyro/views/overview.test.tsx (121 tests passed)
- Validation: pnpm build (pass)
- Files changed: `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/data/remediation-summary.ts`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/data/remediation-summary.test.ts`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/data/ai-scope-corpus.ts`
- Notes: Per approved E3/E4 correction, Lens never injects raw remediation/certification records, snapshots, or evidence bodies into the AI corpus; it emits only a bounded derived summary and failures for invalid provenance.

**Verdict**: pass (waived: The Lens corpus includes validated remediation and certification artifacts when present and records a read failure instead of inventing content when they are not valid. — Superseded by user-approved E3/E4: Lens emits only a bounded derived provenance summary and failures; raw immutable records and evidence bodies are excluded from AI corpus.)

---
### P3 — Lens provenance presentation

> Expose trustworthy remediation status without representing historical evidence as corrected state.

#### T3.4: Render remediation and recertification provenance

**Status**: done

**Description**: Add a read-only overview surface for valid remediation/recertification provenance and a distinct actionable failure state for diverged or unsupported chains.

**Evidence**:
- Summary: Added a read-only Overview provenance card for remediated, recertified, diverged, unsupported, loading, and unavailable states.
- Validation: pnpm exec tsc --noEmit (pass)
- Validation: pnpm exec vitest run src/components/kyro/views/overview.test.tsx src/data/remediation-summary.test.ts src/data/validate.test.ts (105 tests passed)
- Validation: pnpm build (pass)
- Files changed: `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/components/kyro/views/overview.tsx`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/components/kyro/views/overview.test.tsx`
- Notes: The surface is observational: diagnostics explicitly state that Lens neither applies nor repairs historical provenance.

**Verdict**: pass

---
### P4 — Cross-repository certification

> Prove writer, installed runtime, and reader agree on the protocol without claiming publication readiness.

#### T3.5: Exercise the Kyro AI to Lens contract end to end

**Status**: done

**Description**: Create shared, deterministic contract fixtures from real Kyro remediation and recertification output and prove Lens loads valid data while rejecting representative invalid chains.

**Evidence**:
- Summary: Added a real Kyro-to-Lens contract bridge: Kyro exports an actual close/remediate/recertify fixture, then Lens verifies it as recertified and rejects forged or unsupported variants.
- Validation: KYRO_LENS_REAL_FIXTURE=/tmp/kyro-lens-contract-fxeJQ6 node scripts/check-verification-states.mjs (143 assertions passed; exported real fixture)
- Validation: KYRO_LENS_REAL_FIXTURE=/tmp/kyro-lens-contract-fxeJQ6 pnpm --dir /Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens exec vitest run src/data/remediation-real-contract.test.ts (1 test passed)
- Validation: pnpm exec vitest run src/data/remediation-summary.test.ts src/components/kyro/views/overview.test.tsx (23 tests passed)
- Files changed: `scripts/check-verification-states.mjs`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/data/remediation-real-contract.test.ts`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/data/remediation-summary.ts`
- Notes: The first real vector found Lens was hashing external evidence as JSON instead of Kyro raw UTF-8 file bytes. Fixed with a distinct raw-text SHA-256 path; real certification then passed.

**Verdict**: pass

---
#### T3.6: Certify projected runtime parity

**Status**: done

**Description**: Extend the isolated installation harness so the runtime projected under .agents/kyro/current exposes the same remediation verification behavior as the local candidate, then run package and scope gates.

**Evidence**:
- Summary: Extended isolated runtime projection certification so the copied runtime executes the full remediation verification-state harness, not merely an asset-presence check.
- Validation: npm run check:cli-bundle-assets (pass; isolated projected runtime ran all 143 verification-state assertions)
- Validation: npm run check (pass)
- Validation: npm pack --dry-run (pass)
- Validation: pnpm --dir /Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens exec vitest run (841 passed, 1 environment-gated real-contract test skipped)
- Validation: pnpm --dir /Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens build (pass)
- Validation: KYRO_LENS_REAL_FIXTURE=/tmp/kyro-lens-contract-fxeJQ6 pnpm --dir /Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens exec vitest run src/data/remediation-real-contract.test.ts (1 passed)
- Files changed: `scripts/check-cli-bundle-assets.mjs`, `scripts/check-verification-states.mjs`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/data/remediation-real-contract.test.ts`
- Notes: doctor --artifacts is clean for the active scope; analyze retains open debt-3 (quadratic snapshot storage) and debt-4 (historic schema compatibility) as explicit deferred decisions.

**Verdict**: pass

---

## Learnings

_No learnings recorded._

## Resolved Debt

- **debt-1**: npm run check fails while docs/plans/append-only-scope-remediation.md references unshipped verbs
- **debt-2**: resolveRemediationRebase consumes record.result.snapshot without verifying its digest

## Recommendations for Sprint 4

_None recorded._
