---
title: 'append-only-scope-remediation — Sprint 1: Typed remediation protocol and atomic writer'
date: '2026-08-08'
scope: 'append-only-scope-remediation'
sprint: 1
slug: 'typed-remediation-protocol'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 1: Typed remediation protocol and atomic writer

> Closed: 2026-08-08
> Outcome: shipped

## Objective

Define the versioned remediation contract and deliver a fail-closed preview/apply path for the first typed repair operation without changing historical checkpoints.

## Definition of Done

- A closed typed v1 remediation protocol and its only permitted operation are implemented with runtime validation.
- Preview and apply are fail-closed, preserve immutable historical artifacts, and expose no partial state as applied.
- The scope has fixture-backed evidence for the original numeric-origin corruption and for atomic failure paths.
- Doctor chain validation, recertification, and Kyro Lens ingestion remain explicitly deferred to the roadmap's Sprints 2 and 3.

## Phases

### P1 — Protocol contract

> Make remediation artifacts and their permitted operation surface explicit, versioned, and runtime-validatable.

#### T1.1: Define the versioned remediation contract

**Status**: done

**Description**: Add strongly typed remediation, issue, provenance, digest, and operation models; extend the sprint artifact schema with the remediation anchor; and implement the closed v1 operation registry with only debt.origin.set. Define the canonical remediation-state projection so base and result digests do not include the remediation ledger itself.

**Evidence**:
- Summary: Added the v1 append-only remediation contract: ScopeRemediationV1 with base (state digest, remediationHead, checkpoint commitments), issues[], typed operations[], result digest and provenance as explicit exported types; a closed operation registry whose only member is debt.origin.set; the canonical business-state projection that excludes remediations[] so base/result digests cannot form a hash cycle; and a fail-closed remediations[] anchor gate in the SprintFile runtime schema.
- Validation: npm run typecheck — clean
- Validation: npm run build — clean
- Validation: node verify-t11.mjs (scratchpad harness against dist) — 33/33 checks pass: valid record accepted; unknown op kind, injected generic patch payload, string/non-integer/<1 origin, malformed precondition digest, undeclared resolves reference, duplicate issue/op ids, empty issues/operations, unsupported schemaVersion, bad id pattern and bad base/checkpoint/head digests all rejected with field-specific paths; digest unchanged when the remediations anchor is added, changed on business-state change, stable across key order; sprint schema rejects non-array anchors, bad commitments, extra keys, duplicate ids and missing path
- Validation: npm run check — all suites pass except the pre-existing check:cli-verbs failure caused solely by docs/plans/append-only-scope-remediation.md (verified by temporarily removing that untracked doc: check:cli-verbs then passes); logged as debt-1
- Files changed: `src/cli/remediation/protocol.ts`, `src/cli/remediation/canonical-state.ts`, `src/cli/types.ts`, `src/cli/artifacts/schema.ts`
- Notes: Executors/preconditions for debt.origin.set are intentionally left to T1.2 (planner); this task delivers only the contract, registry and digest projection. Rejecting unknown keys on operations and anchors is deliberate so a generic patch payload cannot be smuggled through an otherwise typed record.

**Verdict**: pass

---
### P2 — Planning and durable application

> Plan a remediation against immutable evidence and apply it through one fail-closed writer transaction.

#### T1.2: Build a fail-closed remediation planner

**Status**: done

**Description**: Load a remediation manifest and the target closed scope, verify its checkpoint commitments and base digest, validate every typed operation and precondition, then project the resulting sprint state and remediation record without writing files. The planner must be able to inspect the narrowly targeted raw legacy debt field even when the full live SprintFile fails the current strict schema.

**Evidence**:
- Summary: Added the pure remediation planner: it loads a typed manifest (RemediationManifestV1 with a declared base digest and chain head), verifies every ledger checkpoint by commitment rather than by today's schema, checks the base digest and chain head against live state, evaluates each typed operation's precondition, then projects the corrected state, the R-NNN record, its commitment and the live anchor — writing nothing. Added checkpointCommitmentOfRecord so historical evidence can be verified without passing the current strict SprintFile schema, a REMEDIATION_TRANSACTION_STATUS vocabulary with an explicit PREPARED state for interrupted persistence, and a doctor lens (inspectRemediationChain) wired into artifact-doctor on every path, including the paths where sprint.json itself fails validation.
- Validation: npm run typecheck — clean
- Validation: node verify-t12.mjs (scratchpad harness, real temp workspace with a closed scope, committed checkpoint, snapshot, narrative and a string debt.origin) — 61/61 checks pass
- Validation: Preview purity: full file-tree snapshot of .agents before/after is byte-identical for the happy path and for all 13 rejection cases
- Validation: Rejections proven: stale base digest, wrong chain head, absent debt id, mismatched expected old-value digest, unknown operation kind, injected generic patch payload, string replacement origin, manifest/command scope mismatch, missing checkpoint, tampered checkpoint, corrupted checkpoint JSON, unanchored checkpoint (no checkpointSha256), and a manifest that would leave the state invalid
- Validation: Projection scope: only debt[D-1].origin plus the new anchor differ; ledger, checkpoint reference, snapshot, narrative, previousSprint and handoff are byte-identical, and the checkpoint file on disk is unchanged
- Validation: Atomicity S4: a two-operation batch plans both; making the second operation's precondition stale rejects the whole batch and writes nothing
- Validation: Recovery: record-without-anchor reports PREPARED (never APPLIED), re-planning is idempotent (same R-001 and commitment), completing the write reports APPLIED, and post-hoc live drift reports DIVERGED
- Validation: No regressions: check:sprint-doctor-v4, check:lossless-checkpoints, check:debt, check:status, check:plan, check:artifacts, check:cli-bundle, check:dist all PASS
- Files changed: `src/cli/remediation/plan.ts`, `src/cli/remediation/protocol.ts`, `src/cli/checkpoints/sprint-close.ts`, `src/cli/commands/artifact-doctor.ts`
- Notes: Live state is read raw on purpose — a scope needing remediation is by definition one the strict validator rejects — but the projected state is validated strictly, so a manifest that does not fully repair the scope is refused. Checkpoint verification is commitment-based for the same reason. The CLI surface (remediate preview/apply) is T1.3.

**Verdict**: pass

---
#### T1.3: Apply planned remediations through the locked writer

**Status**: done

**Description**: Implement remediation preview/apply command handling and a transaction that uses the existing state-writer lock, safe managed paths, durable record publication, compare-and-swap of the live scope, read-back validation, and deterministic retry/resume behavior. A validation failure must cause no writes; a write interruption must leave no state that is presented as applied.

**Evidence**:
- Summary: Shipped kyro remediate preview/apply plus the durable transaction. applyRemediationTransaction mirrors applySprintCloseTransaction: it rebuilds the plan INSIDE the state-writer lock, asserts safe managed paths, publishes the immutable R-NNN record with publishExclusive (exported from sprint-close so the fsync/link/parent-fsync discipline is shared, not copied), reads the record back and verifies its commitment, compare-and-swaps the live scope from base digest to result digest, then re-validates the written file strictly and proves the anchor and result digest. Exposed the verb in app.ts (including isMutatingInvocation), help.ts, and MCP as remediate_scope with the same preview/confirm contract.
- Validation: npm run typecheck — clean
- Validation: node verify-t13.mjs (scratchpad, real CLI subprocesses against a temp workspace) — 48/48 checks pass
- Validation: CLI contract: preview writes nothing and prints the typed change and verified checkpoint; apply without --yes fails CONFIRMATION_REQUIRED after showing the plan and writes nothing; unknown subcommand and missing --manifest are rejected
- Validation: Apply: one sequential immutable record at archive/remediations/remediation-001.json plus one matching live anchor; anchor commitment equals sha256(record); live state digest equals record.result.stateSha256
- Validation: Immutability: checkpoint, snapshot and narrative files byte-identical before/after a successful apply; ledger entry including checkpointSha256 unchanged; doctor reports remediation/R-001 APPLIED and validates the corrected sprint.json shape
- Validation: No partial advance: an apply with a failed precondition leaves sprint.json byte-identical, the archive byte-identical, and creates no remediations directory
- Validation: Deterministic retry: re-applying the same committed manifest is refused as STATE_DIVERGED (its base state no longer exists) and creates no second record; an interrupted write (record published, anchor missing) reports PREPARED, and re-running apply resumes the same R-001 with the same commitment rather than creating a competing remediation
- Validation: MCP parity: remediate_scope without confirm returns the plan and writes nothing; with confirm:true it applies through the same locked transaction
- Validation: npm run check — every suite passes except the pre-existing check:cli-verbs failure, now reduced to the single 'kyro recertify' reference in the plan doc (tracked as debt-1); adding remediate resolved the other half
- Files changed: `src/cli/commands/remediate.ts`, `src/cli/remediation/transaction.ts`, `src/cli/app.ts`, `src/cli/help.ts`, `src/cli/mcp/handlers.ts`, `src/cli/mcp/tool-catalog.ts`, `src/cli/remediation/plan.ts`, `src/cli/checkpoints/sprint-close.ts`, `scripts/check-mcp.mjs`, `fixtures/mcp/tool-catalog.golden.json`
- Notes: Two deviations from the planned file list, both required by the acceptance criteria: (1) tool-catalog.ts + its golden fixture and check-mcp.mjs tool count, because an MCP tool cannot be exposed from handlers.ts alone; (2) plan.ts, to fix a real defect this task's tests exposed — createdAt came from the wall clock, so a resumed apply computed a different commitment and the PREPARED path was unreachable. The planner now reuses a prepared record's createdAt, which is what makes retry deterministic; any other difference still diverges. remediate is intentionally NOT added to TOOL_OWNED_VERBS: it is an operator recovery verb, not part of the sprint-lifecycle handshake.

**Verdict**: pass

---
### P3 — Protocol proof

> Lock the first protocol version with fixture-driven regression evidence.

#### T1.4: Prove immutability, typing, and failure atomicity

**Status**: done

**Description**: Add an isolated command-level regression harness covering a closed scope with a historical string debt origin, the valid numeric repair, malformed/unknown operations, stale preconditions, and multi-operation rejection. Wire the harness into the package checks and retain the existing debt and checkpoint suites.

**Evidence**:
- Summary: Added scripts/check-scope-remediation.mjs and wired it into npm run check. The harness closes a scope through the real kyro close-sprint (so the checkpoint, snapshot, narrative and ledger commitment are genuine artifacts, not hand-built look-alikes), then writes prose into the closed scope's live debt origin to reproduce the Lens-visible corruption. It asserts bytes and digests of the original archive before and after every case, not exit status alone. Also extended check-debt.mjs (kyro debt is not a backdoor repair path) and check-lossless-checkpoints.mjs (a remediation leaves checkpoint/snapshot/narrative bytes and the ledger commitment intact).
- Validation: npm run build — clean
- Validation: node scripts/check-scope-remediation.mjs — 220 assertions pass: baseline corruption is rejected by doctor with the field path; preview is byte-pure; apply produces a validated R-001 record plus live anchor and leaves the archive byte-identical; doctor exits 0 and reports APPLIED
- Validation: 12 rejection cases, each run through BOTH preview and apply and each asserting no record, no anchor, unchanged live origin and unchanged archive: unknown operation kind, generic patch payload, string origin, fractional origin, invalid issue digest, undeclared resolves reference, empty provenance actor, stale base digest, stale expected old-value digest, unknown debt id, wrong scope, unsupported schemaVersion
- Validation: Batch atomicity: a two-operation manifest plans both; breaking the second operation's precondition applies neither and touches no history
- Validation: Interrupt/retry: a published record with no live anchor is reported PREPARED and is never presented as a remediation; the retry resumes the byte-equal R-001 rather than creating a second record; replaying the committed manifest is refused as stale
- Validation: Tamper detection: a rewritten anchor commitment and a malformed anchor both fail doctor with DIVERGED / the exact field path
- Validation: npm run check:debt — passes with the new case proving debt add/resolve/escalate all refuse a non-numeric origin, name debt[0].origin, and write nothing
- Validation: npm run check:lossless-checkpoints — passes with the new post-remediation immutability case
- Validation: npm run check — every suite passes except the pre-existing check:cli-verbs failure, now down to the single 'kyro recertify' reference in the plan doc (debt-1); all 21 suites after it in the chain were run individually and pass
- Files changed: `scripts/check-scope-remediation.mjs`, `scripts/check-lossless-checkpoints.mjs`, `scripts/check-debt.mjs`, `package.json`
- Notes: The harness exposed a real defect in the already-reviewed T1.2/T1.3 work: a successful remediation made doctor report the close checkpoint as DIVERGED. That is why the earlier synthetic-checkpoint harness missed it. Raised as emergent task E1, fixed, and reviewed separately rather than folded silently into this task.

**Verdict**: pass

---

## Learnings

- Independent certification found a critical defect that maker-checker had passed: a valid remediation could launder unrelated post-close tampering, flipping doctor from DIVERGED to certified. Budget for an independent adversarial pass on any integrity-critical feature; self-review did not catch it.
- Fixtures decide what tests can see. The synthetic checkpoint used through T1.1-T1.3 hid the doctor divergence entirely; only closing a scope through the real close-sprint exposed it. Build fixtures from the real write path, not from hand-assembled look-alikes.
- Hardening in one direction introduced false negatives in the other: after E2 tightened integrity, a genuine two-record chain and a two-operation batch were both reported as tampering. Every integrity change needs probes on the honest path too, not only on the attack path.
- The planner and the verifier disagreed because they were two implementations of the same rule — a batch was accepted at apply time and then failed its own replay. Sharing one sequential executor made that class of defect impossible by construction rather than patched.

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 2

- Sprint 2 (R5) should replace the current binary checkpoint verdict with the real state vocabulary: historical, remediated, recertified, diverged, unsupported. Today a legacy checkpoint that embeds a value the current schema rejects stays permanently invalid to doctor even after its live state is correctly remediated.
- kyro recertify (R6) closes debt-1: check:cli-verbs fails only on that unshipped verb referenced in docs/plans/append-only-scope-remediation.md.
- Before Lens ingestion (R7), confirm Lens resolves remediation records through remediations[].path — E3 made that field authoritative by binding it to the anchor id, and the reader must agree with doctor about which file is the evidence.
- Re-run an independent QA certification of this scope when budget allows; the closing audit was performed by the same session that wrote the code.
