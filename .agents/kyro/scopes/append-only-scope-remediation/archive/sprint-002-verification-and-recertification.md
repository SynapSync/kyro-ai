---
title: 'append-only-scope-remediation — Sprint 2: Chain verification and recertification'
date: '2026-08-08'
scope: 'append-only-scope-remediation'
sprint: 2
slug: 'verification-and-recertification'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 2: Chain verification and recertification

> Closed: 2026-08-08
> Outcome: shipped

## Objective

Report the truth about a remediated scope through a typed state vocabulary, and let a corrected scope earn a separate immutable certificate only on real evidence.

## Definition of Done

- R5 and R6 are satisfied: the verification vocabulary is reported truthfully by doctor and status, and a certificate exists only on a valid chain plus real evidence.
- npm run check passes in full, including check:cli-verbs, with debt-1 resolved.
- Every historical artifact — checkpoints, snapshots, narratives, ledger commitments and Sprint 1 remediation records — remains byte-identical, asserted rather than assumed.
- An INDEPENDENT QA certification passes before close. Sprint 1's closing audit was self-audited because both certifier agents died, and its recommendation to re-certify is carried into this sprint.
- No task is closed on evidence that overstates what the code does; a fixture that cannot fail is not proof.

## Phases

### P1 — Chain-aware verification

> Replace the binary checkpoint verdict with states that distinguish intact history, an audited correction, a certified scope, tampering, and a protocol this runtime cannot evaluate.

#### T2.1: Introduce the typed scope verification vocabulary

**Status**: done

**Description**: Define historical, remediated, recertified, diverged and unsupported as an explicit exported union, derive it from the existing checkpoint position plus the replayed remediation chain, and surface it in doctor --artifacts and status. Sprint 1 collapsed all of this into pass/fail plus a free-text label, so a reader cannot distinguish an audited correction from tampering without parsing prose.

**Evidence**:
- Summary: Fixed the active-sprint false DIVERGED found in code review. The verification derivation compared live state against the checkpoint after-image, and the chain walk compared the head record's result digest against live state, with no guard for a later sprint having started. Once sprint N+1 was under way its ordinary edits moved live state off both images by design, so doctor reported 'diverged' and exited 1 on normal in-sprint work — including on this very scope. artifact-doctor.ts already drew this line via supersededByActiveSprint; the remediation and verification lenses did not. Added the shared isSupersededByActiveSprint helper and applied it in inspectRemediationChain and deriveScopeVerificationState. Record integrity, commitments and chain continuity are still enforced while a sprint is active; only the drift comparison is suspended, and a scope with no chain reports no verification state at all rather than a misleading one.
- Validation: node dist/cli.js doctor --artifacts --kyro-scope append-only-scope-remediation — exit 0, no verification failure (was exit 1, 'diverged')
- Validation: node dist/cli.js doctor --artifacts (all scopes) — exit 0
- Validation: node scripts/check-verification-states.mjs — 137 assertions, including two new active-sprint regressions: closed sprint 1 + planned sprint 2 keeps doctor green with and without a remediation chain
- Validation: Mutation test: forcing isSupersededByActiveSprint to false fails the harness with 'active sprint: doctor must stay green while sprint 2 is active, got exit 1'
- Validation: Chain health still enforced under an active sprint: tampering with a published record still reports diverged and exits non-zero (asserted in case 15)
- Validation: npm run check — full suite green (NPM_CHECK_EXIT=0)
- Files changed: `src/cli/remediation/plan.ts`, `scripts/check-verification-states.mjs`

**Verdict**: pass

---
#### T2.2: Report a legacy checkpoint as historical evidence, not as corruption

**Status**: done

**Description**: A checkpoint that embeds a value today's stricter schema rejects is currently reported CORRUPT forever, even after its live state has been correctly remediated, because validateSprintCloseCheckpoint runs the current SprintFile validator over the frozen before/after images. Separate structural integrity, which is commitment-based and must stay strict, from schema currency, which is a statement about the runtime rather than about the artifact.

**Evidence**:
- Summary: Fixed the integrity regression the certification found. The T2.2 implementation returned APPLIED as soon as checkpointSchemaIssues() reported a stale field, and that early return skipped everything after it: inspectArtifact on the legacy snapshot and the narrative, plus the live-state and project-scope position comparisons. A stale-schema checkpoint therefore stopped verifying its own immutable artifacts, and tampering with the narrative or snapshot bytes produced a byte-identical [PASS] APPLIED line. The schema issues are now carried as a 'historical:' note prefixed onto whatever detail the full verification produces, so the stale fields are still named (AC1) while every digest check still runs and still fails closed (AC2).
- Validation: node scripts/check-verification-states.mjs — 121 assertions, including a stale-schema checkpoint re-anchored honestly: intact artifacts report 'historical: ... narrative=ok', tampering reports narrative=conflict and doctor exits non-zero
- Validation: Mutation test: restoring the early return fails the harness with 'stale-schema checkpoint: artifact integrity was not evaluated at all'
- Validation: npm run check:lossless-checkpoints and npm run check:sprint-doctor-v4 — both pass unchanged
- Validation: npm run check — full suite green (NPM_CHECK_EXIT=0)
- Files changed: `src/cli/commands/artifact-doctor.ts`

**Verdict**: pass

---
### P2 — Recertification

> Let a corrected scope earn a separate immutable certificate, and only on a valid chain plus real checker evidence.

#### T2.3: Define the versioned recertification contract

**Status**: done

**Description**: Add ScopeRecertificationV1 with its own schemaVersion and kind, binding the certified chain head commitment, the certified state digest, the named validation evidence, the checker verdict and provenance, plus a live certifications[] anchor mirroring the remediation anchor. Reuse the remediation protocol's fail-closed validator style: explicit exported types, no unknown payload, field-specific rejection paths.

**Evidence**:
- Summary: Completed the contract beyond the type declarations. canonical-state.ts now excludes certifications[] as well as remediations[] (AC2 — previously missing, which made certifying a healthy scope report it as diverged). schema.ts gained validateCertificationAnchors, rejecting a malformed commitment, an id that is not C-NNN, a path that is not the path derived from that id, a duplicate id and unknown keys (AC3 — schema.ts had zero mentions of certifications before). validateScopeRecertification was hardened: certifiedChainHeadCommitment and certifiedStateDigest must be 64-hex rather than merely non-empty, empty evidence is rejected, and unknown keys in identity/verdict/provenance are rejected. certificationCommitment now includes certificationId so two certificates with different ids cannot share a commitment (the E3 lesson).
- Validation: node scripts/check-verification-states.mjs — 121 assertions; a certification anchor appended to a healthy scope leaves the business digest unchanged and doctor stays green
- Validation: Mutation test: reverting REMEDIATION_EXCLUDED_STATE_KEYS to ['remediations'] fails the harness ('doctor reported diverged, expected remediated')
- Validation: Mutation test: removing the chain-head binding in resolveCertificationForChainHead fails the isolated 1->2->1 case, where the business digest returns to the certified value and only the binding can detect the moved head
- Validation: npm run check — full suite green (NPM_CHECK_EXIT=0)
- Files changed: `src/cli/remediation/canonical-state.ts`, `src/cli/remediation/certification.ts`, `src/cli/artifacts/schema.ts`

**Verdict**: pass

---
#### T2.4: Ship kyro recertify through the locked writer

**Status**: done

**Description**: Implement recertify preview/apply reusing the Sprint 1 transaction discipline: rebuild the plan inside the state-writer lock, verify the remediation chain replays to the live state, require named validation evidence and a passing checker verdict, publish one immutable C-NNN exclusively, append one live anchor, then read both back and verify their digests. Expose it on CLI and MCP consistently.

**Evidence**:
- Summary: Replaced the T2.4 stub with a real implementation. planCertification builds the warrant (chain must replay to live state, chain head must match, evidence non-empty and re-derived from the workspace, verdict must be pass); applyCertificationTransaction runs it under withStateWriterLock, rebuilding the plan inside the lock, publishing exactly one immutable C-NNN via publishExclusive, appending one live anchor via atomicReplace, then reading both back. An interrupted apply reports PREPARED and the retry reuses the prepared record's createdAt/recordedAt so it reproduces the same commitment instead of minting a second certificate. Exposed identically on CLI (recertify preview|apply) and MCP (recertify_scope), with tool-catalog, golden fixture and check-mcp tool count updated. All 'sha256-placeholder'/'placeholder'/'T2.4 stub' values are gone.
- Validation: npm run check — full suite green end to end (NPM_CHECK_EXIT=0), including check:cli-verbs which resolves 28 real verbs
- Validation: node scripts/check-verification-states.mjs — 121 assertions covering preview-writes-nothing, apply-refuses-without-yes, one-record-one-anchor with byte-identical history, PREPARED resume producing exactly 1 record and 1 anchor, and 6 refusal paths
- Validation: npm run check:mcp — MCP stdio conformance passed with 11 tools
- Validation: Mutation test: reverting resolveCertificationForHead to the stub fails the harness ('doctor reported remediated, expected recertified'), proving recertified is genuinely reachable and asserted
- Files changed: `src/cli/commands/recertify.ts`, `src/cli/remediation/certification-plan.ts`, `src/cli/remediation/certification-transaction.ts`, `src/cli/mcp/handlers.ts`, `src/cli/mcp/tool-catalog.ts`

**Verdict**: pass

---
### P3 — Proof and debt closure

> Prove the verification and certification semantics adversarially, and close the debt Sprint 1 could not.

#### T2.5: Prove the verification states and certification failure paths

**Status**: done

**Description**: Extend the regression harness with the full state matrix and the certification failure paths, then close debt-1 now that kyro recertify exists. Build fixtures from the real close and remediate paths, never from hand-assembled look-alikes.

**Evidence**:
- Summary: Rewrote check-verification-states.mjs, which previously had zero asserts, a hardcoded absolute repo path, four of five states marked (Skipped), and printed 'All tests passed' unconditionally — it could not exit non-zero. The harness now builds every fixture through the real close-sprint, remediate and recertify commands and asserts 121 conditions: all five states by name in both doctor and status, the stale-schema checkpoint case that proves artifact digests are still verified, the certification failure paths (empty evidence, failing verdict, stale chain head, unknown manifest schemaVersion, missing evidence artifact, mismatched evidence digest, forged record, hand-written anchor), PREPARED resume, and the isolated chain-head binding case. Registered in package.json and in the npm run check chain. debt-1 resolved through the CLI.
- Validation: node scripts/check-verification-states.mjs — 121 assertions passed
- Validation: npm run check — full suite green end to end (NPM_CHECK_EXIT=0), including check:cli-verbs (AC4)
- Validation: Mutation testing proves the harness binds: restoring the T2.2 early return, reverting the certifications[] exclusion, stubbing resolveCertificationForHead, and removing the chain-head binding each fail it with a specific message
- Files changed: `scripts/check-verification-states.mjs`, `package.json`

**Verdict**: pass

---

## Learnings

- A harness that cannot exit non-zero certifies nothing. check-verification-states.mjs had zero asserts and printed 'All tests passed' unconditionally while four of five states were skipped; the suite was green throughout.
- Mutation testing is the only proof a regression test binds. Four fixes were each verified by reverting them and confirming a specific failure — one such run exposed that the chain-head binding case was actually covered by the state-digest check, not by the binding it claimed to test.
- A guard that exists in one lens must be shared, not reimplemented. artifact-doctor.ts already knew about supersededByActiveSprint; because the remediation and verification lenses did not, ordinary in-sprint work was reported as tampering.

## Resolved Debt

- **debt-1**: npm run check fails while docs/plans/append-only-scope-remediation.md references unshipped verbs

## Recommendations for Sprint 3

- Resolve debt-2 first: verify stateDigest(record.result.snapshot) === record.result.stateSha256 inside the replay loop, or drop snapshot and replay from the computed next state. It is not exploitable today only because chainContinuityIssue runs first.
- Certify a global install, not just the local checkout. The installed runtime did not surface the verification state, which is what made the active-sprint false DIVERGED easy to miss.
- Close S3/Lens and the R7 coverage that analyze still reports as pending before certifying the scope end to end.
