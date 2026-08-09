---
docType: plan
date: 2026-08-07
slug: append-only-scope-remediation
title: Append-only scope remediation and recertification
maturedFrom: mature
agents: []
---

# Append-only scope remediation and recertification

Kyro will support correcting a closed scope's live state without rewriting its historical checkpoint. The repair is recorded as a new, typed, atomic remediation; a later certificate proves the corrected state passed its gates. This keeps Lens usable without pretending the original close was valid.

## Problem and outcome

Kyro previously accepted a `Debt.origin` string while Lens correctly rejected it. The affected scope was already closed, and its checkpoint commitment proves its original before/after images. Editing that checkpoint would erase evidence and invalidate the commitment. Current `kyro repair` deliberately normalizes only deterministic status and formatting drift, so it cannot resolve semantic schema defects safely.

The new workflow must produce this chain:

```text
immutable checkpoint(s) ──► R-001 remediation ──► corrected live sprint.json
                                                       │
                                                       └──► C-001 recertification
```

`R-001` and `C-001` are not sprints and do not duplicate a scope or checkpoint.

## Protocol decisions

| Topic | Decision |
| --- | --- |
| Public command | Add `kyro remediate`; do not overload `kyro repair`. |
| Mutation model | A remediation is an all-or-nothing batch of strongly typed operations. Generic JSON Patch is prohibited. |
| First operation | `debt.origin.set`, with an explicit numeric value supplied by the operator. |
| Historical proof | Checkpoint files, snapshots, narratives, and existing ledger commitments are immutable. |
| Live-state anchor | `sprint.json.remediations[]` stores `{ id, path, commitment }` records, not duplicate state images. |
| Remediation evidence | Immutable files live under `archive/remediations/remediation-NNN.json`. |
| Certification | `kyro recertify` writes a separate immutable `C-NNN` record only after remediation verification and checker evidence. |
| Reader behavior | Kyro Doctor and Lens must show `remediated` or `recertified`; neither may present the historical close as originally valid. |

The business-state digest excludes `remediations[]`. This allows the live ledger to anchor a remediation commitment without creating a hash cycle. Doctor validates the business-state projection and the ledger independently.

## Typed remediation contract

```ts
interface ScopeRemediationV1 {
  schemaVersion: 1;
  kind: 'scope-remediation';
  id: string; // R-001
  scope: string;
  createdAt: string;
  base: {
    stateSha256: string;
    remediationHead: string | null;
    checkpoints: Array<{ path: string; commitment: string }>;
  };
  issues: Array<{
    id: string;
    code: string;
    path: string; // diagnostic only; never an executable JSON Pointer
    observedValueSha256: string;
  }>;
  operations: RemediationOperation[];
  result: { stateSha256: string };
  provenance: { reason: string; actor: string; kyroVersion: string };
}

type RemediationOperation = SetDebtOriginOperation;

interface SetDebtOriginOperation {
  id: string;
  kind: 'debt.origin.set';
  resolves: string[];
  debtId: string;
  expectedOriginSha256: string;
  origin: number;
  reason: string;
}
```

Each operation is a discriminated-union member with its own validation, preconditions, executor, and regression tests. New correction capabilities are additive; an unknown `kind` fails before planning. `issues[]` and `operations[]` permit multiple related corrections in one transaction, and `resolves[]` preserves the exact issue-to-operation mapping.

The record commitment covers the base, issues, operations, result, and provenance. The live remediation ledger anchors that commitment. A later remediation must reference the preceding commitment through `remediationHead`, preventing a chain fork or bypass.

## Commands and state transitions

1. `kyro remediate preview --kyro-scope <scope> --manifest <path>` validates the manifest, checkpoint commitments, base digest, operation preconditions, projected result, and final sprint schema. It performs no writes.
2. `kyro remediate apply --kyro-scope <scope> --manifest <path> --confirm` repeats every validation under the state-writer lock. It writes the corrected live sprint, appends one ledger anchor, persists `R-NNN`, and re-reads the chain before reporting success.
3. `kyro recertify --kyro-scope <scope> --remediation R-NNN --confirm` verifies the remediation chain and writes `C-NNN` only with named validation evidence and a checker verdict. A failed review never creates a passing certificate.

The implementation must reject the entire transaction, without writes, when any of these occurs: a stale base digest, changed observed value, mismatched checkpoint commitment, unknown operation, invalid typed payload, invalid result schema, write interruption, or post-write verification mismatch.

## Doctor and Lens behavior

Doctor must first verify the original checkpoint as historical evidence, then validate the remediation chain against the current live state. It must distinguish:

- `historical`: original checkpoint intact but not the current canonical state;
- `remediated`: valid `R-NNN` chain, no valid `C-NNN` yet;
- `recertified`: valid remediation plus valid certification;
- `diverged`: any digest, commitment, ordering, or result mismatch;
- `unsupported`: an unknown remediation or certification schema version.

Lens must parse the same versioned structures and fail closed if unsupported. A valid chain should remain visible with the original defect, remediation rationale, operations, and certification status; invalid chains must produce actionable diagnostics rather than silently falling back to stale state.

## Scope boundaries

In scope:

- schema/types, canonical digest projection, typed operation registry, preview/apply, durable transaction handling, remediation ledger, Doctor/status validation, recertification records, Lens ingestion, and regression coverage;
- an end-to-end `debt.origin.set` slice;
- atomic batches containing multiple typed operations.

Out of scope:

- generic JSON Patch, automatic semantic conversions, checkpoint rewriting, changes to task evidence or verdicts, backup/Git restoration of missing checkpoint bytes, and production-readiness claims.

Restoring a missing or damaged checkpoint is a distinct recovery feature: it requires a separately designed trusted-source policy and must restore bytes that match the existing commitment.

## Execution plan

1. Define `ScopeRemediationV1`, `ScopeRecertificationV1`, the remediation ledger entry, validation functions, commitment rules, and the business-state projection.
2. Implement the operation registry and the `debt.origin.set` handler with explicit preconditions. Add preview/apply transaction planning under the existing state-writer lock.
3. Add archive persistence, id generation, durable writes, idempotency/retry rules, and post-write verification.
4. Extend Doctor and status output with chain-aware states while retaining strict immutable-checkpoint validation.
5. Add recertification records and evidence/verdict validation.
6. Update Lens after the shared protocol is stable; make the reader render provenance and reject invalid or unsupported chains.

## Acceptance matrix

| Scenario | Required proof |
| --- | --- |
| Valid remediation | Checkpoint bytes/commitment remain identical; corrected state matches `R-NNN.result.stateSha256`. |
| Two-operation batch | Both operations apply or no state, ledger, or archive file changes. |
| Stale or tampered input | Preview/apply fails with the exact base, operation, or checkpoint mismatch and writes nothing. |
| Unknown operation | Typed registry rejects it before any plan is produced. |
| Interrupted apply / retry | No partial durable state; retry is safe and does not create a duplicate remediation. |
| Remediated but uncertified scope | Doctor reports `remediated`, not `recertified`. |
| Failed recertification | No passing `C-NNN` exists; failure evidence remains visible. |
| Lens compatibility | A valid chain loads with provenance; unsupported or invalid chains fail closed. |

## Future Kyro scope handoff

**Proposed scope:** `append-only-scope-remediation`

**Objective:** Safely remediate and recertify closed Kyro scopes without changing immutable checkpoint history.

**Ordering constraint:** stabilize the Kyro AI protocol and writer/Doctor behavior before Lens ingestion. The first delivery slice is `debt.origin.set`; every additional correction type requires its own typed union member and regression matrix.

**Non-goals:** generic patches, silent normalization, historical rewriting, backup restoration, and production certification.
