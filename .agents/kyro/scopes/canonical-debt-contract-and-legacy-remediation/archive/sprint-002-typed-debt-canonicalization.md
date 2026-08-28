---
title: 'canonical-debt-contract-and-legacy-remediation — Sprint 2: Typed debt canonicalization and operator preparation'
date: '2026-08-10'
scope: 'canonical-debt-contract-and-legacy-remediation'
sprint: 2
slug: 'typed-debt-canonicalization'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 2: Typed debt canonicalization and operator preparation

> Closed: 2026-08-10
> Outcome: shipped

## Objective

Define the versioned, closed debt.canonicalize operation and a read-only preparation flow that turns an observed legacy debt into an explicit, reviewable canonicalization manifest without mutating scope state.

## Definition of Done

- A debt.canonicalize plan is protocol-versioned, closed, whole-debt-bound, and produces an exact canonical after-image.
- Preparation and preview are read-only, distinguish evidence from operator authority, and fail closed when any decision is unresolved.
- Existing remediation versions and immutable history remain untouched and verified.
- The aggregate and projected-runtime checks pass; apply, replay, and recertification remain explicitly deferred to Sprint 3.

## Phases

### P1 — Versioned canonicalization contract

> Make the operation schema exact and replay-addressable before any planner can construct it.

#### T2.1: Define protocol revision and typed debt.canonicalize operation

**Status**: done

**Description**: Add an explicit remediation protocol revision and a closed debt.canonicalize operation that identifies one debt entry, binds the complete observed debt collection with a digest, preserves id/title/status, carries all operator-authorized canonical values, and declares an exact seven-key after-image. Reject generic paths, unknown keys, hybrid output, and malformed manifests at the schema boundary.

**Evidence**:
- Summary: Added remediation protocol revision 3 and the closed debt.canonicalize operation. The revision is explicit rather than a silent v2 extension (ADR-0003), and CURRENT_SCOPE_REMEDIATION_SCHEMA_VERSION deliberately stays at v2 so nothing yet writes a v3 record and the debt.origin.set flow emits exactly what it did. OPERATION_KINDS_BY_REVISION binds each kind to the revision that introduced it, so a v1/v2 record or manifest carrying debt.canonicalize is rejected rather than reinterpreted, while a v3 record still carries debt.origin.set unchanged. The operation is record-level and closed: one debtId, a precondition digest over the COMPLETE observed debt[] collection, an explicit retiredKeys list, and an after-image validated to exactly the seven canonical keys with valid literals and identity matching debtId. verifyCanonicalizePreconditions is a pure read-only check against observed state: stale collection digest, missing debt, title/status drift, an unlisted surviving legacy key, or retiring a key the record does not carry all fail closed. Application is deliberately absent: the executor returns the new UNSUPPORTED_OPERATION error instead of half-applying.
- Validation: npm run typecheck -> 0; npm run build -> 0; npm run check (aggregate) -> exit 0
- Validation: npm run check:scope-remediation -> 339 assertions passed (was 307): +32 covering revision binding, malformed shapes and preconditions
- Validation: schema rejections proven by field path: unknown operation key, smuggled generic patch (path/value), non-digest precondition, hybrid after-image, missing canonical key, invalid literal, wrong type, identity drift, retiring a canonical key
- Validation: precondition rejections proven: another debt entry changing the bound collection, title drift, status drift, unaccounted legacy key, retiring an absent key, unknown debtId
- Validation: real CLI against a real closed scope: remediate preview and remediate apply of a v3 canonicalization both exit non-zero with UNSUPPORTED_OPERATION; archive bytes, live debt, anchors and records all unchanged
- Files changed: `src/cli/remediation/protocol.ts`, `src/cli/remediation/plan.ts`, `src/cli/core/errors.ts`, `scripts/check-scope-remediation.mjs`
- Notes: No apply path, state write, checkpoint edit or historical rewrite was added. src/cli/types.ts and src/cli/artifacts/schema.ts were listed in taskFiles but needed no change: the operation and after-image types live in the protocol module, which by design does not depend on the live-state or validator layers, and the sprint.json debt boundary was already made exact in Sprint 1. Added one error code, UNSUPPORTED_OPERATION, for a defined operation this runtime can prepare but deliberately not apply.

**Verdict**: pass

---
#### T2.2: Plan canonicalization from raw debt without write authority

**Status**: done

**Description**: Implement the pure planner that consumes assessRawDebt output plus explicit operator values, derives technical digests and exact canonical projection, and returns either INPUT_REQUIRED diagnostics or a complete canonicalization plan. Suggestions and evidence must remain distinct from operator-supplied values.

**Evidence**:
- Summary: Added src/cli/remediation/canonicalize-plan.ts, a pure total planner that consumes assessRawDebt output plus explicit operator decisions and returns READY, INPUT_REQUIRED or NOT_APPLICABLE. It keeps three things apart by construction: observed facts (id, title, status and any already-valid canonical value are carried through unchanged), evidence (addedSprint for a broken origin, the compatibility-composed note for an absent one — offered as suggested, never adopted), and decisions (the only thing that resolves an unsettled field). priority and targetSprint carry no evidence at all, because no observation implies a business judgment. A decision aimed at an already-canonical field is refused as NOT_NEGOTIABLE rather than silently applied, so canonicalization cannot smuggle a content edit; an invalid supplied value is REJECTED rather than coerced. READY emits one record-level operation binding the whole-collection digest, preserving identity and lifecycle, retiring legacy keys only in the proposed after-image, with exactly the seven canonical keys. Added debtCollectionDigest to canonical-state.ts.
- Validation: npm run typecheck -> 0; npm run build -> 0; npm run check (aggregate) -> exit 0
- Validation: npm run check:scope-remediation -> 393 assertions passed (was 339 after T2.1): +54 covering the planner
- Validation: INPUT_REQUIRED proven for the faithful D1: origin INVALID with addedSprint=1 evidence, priority and targetSprint ABSENT with null evidence and null suggestion, no operation produced
- Validation: authorization proven to beat suggestion: with addedSprint=1 evidence, an operator origin of 2 yields after.origin===2; an absent note offers the composed 'Resolution: ...' but only the operator value becomes canonical
- Validation: planner output round-trips: it validates clean as a v3 manifest and satisfies verifyCanonicalizePreconditions against the same observed collection; identical input yields byte-identical plans
- Validation: non-write proven structurally (the compiled dependency graph is walked and may not require any node builtin) and empirically (planning a real closed scope leaves the scope tree byte-identical, with no anchor or record)
- Files changed: `src/cli/remediation/canonicalize-plan.ts`, `src/cli/remediation/canonical-state.ts`, `scripts/check-scope-remediation.mjs`
- Notes: Deliberate structural choice: the planner is a new module rather than a function inside plan.ts. plan.ts imports the filesystem at module scope, so a 'pure' function there would be pure only by inspection; in its own module the absence of write authority is a checkable property of the dependency graph, which is exactly what the acceptance criterion asks to prove. Running the planner against the real closed-scope fixture surfaced the NOT_NEGOTIABLE rule working on real data: that record's only defect is its origin, so a supplied priority was correctly refused.

**Verdict**: pass

---
### P2 — Operator preparation and preview

> Expose preparation as a transparent read-only workflow and bind it to regression evidence.

#### T2.3: Expose read-only prepare and preview surfaces

**Status**: done

**Description**: Expose the canonicalization planner through the existing remediation CLI and MCP surfaces as read-only preparation and preview modes. They must render classification, evidence, unresolved decisions, digest, and a complete manifest only when all values are explicit; they must not advertise apply as available until Sprint 3.

**Evidence**:
- Summary: Exposed the planner as read-only preparation and preview on both surfaces, backed by one shared module (src/cli/remediation/canonicalize-surface.ts) so CLI and MCP cannot drift into different answers. CLI: kyro remediate canonicalize-prepare --debt <id> [--origin|--priority|--target-sprint|--note] and kyro remediate canonicalize-preview --manifest <path>. MCP: remediate_canonicalize_prepare and remediate_canonicalize_preview, both annotated readOnlyHint. Decisions are opt-in per field on both surfaces — an omitted flag or argument means undecided, never adopt the suggestion — and target_sprint_null exists because an explicit null is a decision that must be distinguishable from silence. Prepare renders classification, observed values, undecided fields with their evidence, and the whole-debt digest; it returns a complete v3 manifest only when every value is settled, and never saves it. Preview re-checks a held manifest against live state, showing the exact after-image only when the manifest is complete and still true, and exiting non-zero otherwise. Help and the tool catalog describe both as read-only and state plainly that no canonicalize-apply verb exists.
- Validation: npm run typecheck -> 0; npm run build -> 0; npm run check (aggregate) -> exit 0
- Validation: npm run check:scope-remediation -> 444 assertions passed (393 after T2.2): +51 covering both surfaces
- Validation: CLI/MCP parity asserted by byte-comparing the CLI --json payload against the real MCP dispatcher in a child process, for both the incomplete and the complete case
- Validation: no state or trace mutation: the digest of every byte under the scope, archive and trace is identical before and after prepare and preview, and no manifest file is created
- Validation: preview accepts the manifest prepare produced, then exits 1 naming expectedDebtCollectionSha256 once another debt entry moves the bound collection, and shows no after-image when rejected
- Validation: npm run check:mcp -> passes with the regenerated 13-tool golden catalog; kyro remediate canonicalize-apply -> UNKNOWN_SUBCOMMAND
- Validation: the origin-only flow is unchanged: its existing suite still passes, and an origin-only manifest handed to canonicalize-preview is routed back to it rather than half-accepted
- Files changed: `src/cli/remediation/canonicalize-surface.ts`, `src/cli/commands/remediate.ts`, `src/cli/mcp/handlers.ts`, `src/cli/mcp/tool-catalog.ts`, `scripts/check-mcp.mjs`, `fixtures/mcp/tool-catalog.golden.json`, `scripts/check-scope-remediation.mjs`
- Notes: JsonSchemaProperty gained a number variant so origin and target_sprint are declared as the numbers they are rather than as strings. The MCP golden catalog was regenerated from the built catalog (11 -> 13 tools) and check-mcp expectations updated. src/cli/help.ts needed no change: remediate help is owned by the command module. Coverage lives in check-scope-remediation rather than check-cli-verbs because it needs a real closed-scope fixture.

**Verdict**: pass

---
#### T2.4: Certify typed planning and non-mutation boundaries

**Status**: done

**Description**: Extend focused remediation checks with faithful D1-shaped raw debt, incomplete-operator-input, complete-manifest, stale-digest, and legacy-protocol cases. Prove source and projected runtime parity for preparation without claiming the future apply, replay, or recertification behavior.

**Evidence**:
- Summary: Certified the planning slice and its non-mutation boundaries. The faithful incident shape is now read from fixtures/debt-contract/golden.json rather than retyped in the harness, with sentinels asserting the string origin, the absent canonical fields and the three legacy keys survive — cleaning the corpus now breaks this gate instead of silently weakening it. The classifier and the planner are bound to each other across all 14 golden cases: canonical and unsupported records must be NOT_APPLICABLE, legacy-compatible and remediation-required must be describable, the planner must carry the classifier's verdict, and any after-image it produces must hold exactly the canonical key set. The projected runtime now runs the same corpus through the planner AND drives the read-only CLI preparation end to end, asserting INPUT_REQUIRED without decisions, READY with them, a protocol v3 manifest, an unmodified scope and no manifest file on disk. Nothing about apply, resume, replay or recertification is claimed: R5 and R6 gates are untouched and no apply success is fabricated.
- Validation: npm run build -> 0; npm run check (aggregate) -> exit 0
- Validation: npm run check:scope-remediation -> 456 assertions (307 before this sprint); check:debt-contract -> 239 over 14 cases; check:debt-contract-fixture -> 35 (14 cases, 33 mutations); check:debt, check:mcp, check:verification-states (185) all pass unchanged
- Validation: npm run check:cli-bundle-assets -> projected runtime classifies the full corpus and completes read-only preparation: INPUT_REQUIRED then READY, v3 manifest, scope byte-identical, no manifest written
- Validation: faithful D1 flow proven end to end: INPUT_REQUIRED naming origin (INVALID, addedSprint=1 evidence) plus priority and targetSprint with no suggestion at all, then an exact typed plan once every value is explicit, with the scope, archive and trace byte-identical throughout
- Validation: stale whole-debt state and malformed manifests fail closed; v1/v2 records and the origin-only flow retain their previous passing coverage
- Validation: node dist/cli.js doctor --artifacts -> exit 0, zero FAIL; analyze -> 4 finding(s) CRITICAL=0 HIGH=0 MEDIUM=4, all of them R5/R6/R7/R9 scenario coverage explicitly deferred to later sprints
- Validation: KYRO_LENS_ROOT=<lens> check:lens-debt-contract -> 14 golden cases conform; Lens worktree byte-identical; the Aliva checkout was never referenced this sprint
- Files changed: `fixtures/debt-contract/golden.json`, `scripts/check-debt-contract.mjs`, `scripts/check-scope-remediation.mjs`, `scripts/check-cli-bundle-assets.mjs`
- Notes: R3 and R4 now have scenario coverage through S7/S8/S9, which is why analyze dropped from 6 MEDIUM to 4. The projected-runtime gate is a targeted preparation probe rather than a second full run of check:scope-remediation, which would have added ~14s to the aggregate chain for the same signal. package.json needed no change: both focused suites were already wired into the aggregate chain in Sprint 1.

**Verdict**: pass

---

## Learnings

- The planner must be a separate module from plan.ts to make write-authority absence a checkable graph property, not just an inspection claim.
- Remediation protocol revisions must be explicit — v3 must reject debt.canonicalize in v1/v2 records rather than silently extending.

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 3

- Sprint 3 must implement atomic apply, resume, replay, and recertification under the state-writer lock without weakening historical integrity.
- Lens contract parity in Sprint 4 requires independent verification of the new canonicalization provenance and remediation state.
