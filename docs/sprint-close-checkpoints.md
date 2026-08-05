# Lossless sprint-close checkpoints

Every new sprint close publishes an immutable, versioned checkpoint before changing live scope state. This is the authoritative recovery artifact; the existing ActiveSprint JSON remains available for backward-compatible readers.

## Files written

| File | Contract |
| --- | --- |
| `sprint-NNN-slug.checkpoint.json` | Complete transaction record: full scope state before close and intended after close, affected project-state scope entry, frozen inputs, paths, and SHA-256 digests. |
| `sprint-NNN-slug.json` | Legacy verbatim `ActiveSprint` snapshot. It does not contain historical debt, spec, roadmap, handoff, or scope status. |
| `sprint-NNN-slug.md` | Deterministic human-readable narrative. |

`ledger[].checkpoint` and `ledger[].checkpointSha256` are additive; `ledger[].snapshot` remains unchanged. The digest in the live ledger is an external commitment to the checkpoint payload. Historical legacy archives are not backfilled because their missing scope fields cannot be reconstructed honestly.

## Checkpoint v1

The public TypeScript contract is `SprintCloseCheckpointV1`. Its stable envelope is:

```text
schemaVersion + kind + checkpointId + createdAt
identity + close + paths + digests
beforeClose + intendedAfterClose
projectScopeBefore + projectScopeAfter
```

Digests use SHA-256 over canonical JSON for structured state and exact UTF-8 bytes for the legacy snapshot and narrative. Consumers must reject unsupported versions and digest mismatches rather than guessing.

The ledger commitment detects archive-only tampering even if someone rewrites embedded states and recomputes the checkpoint's internal digests. Its trust boundary is the live/versioned scope state: an attacker able to rewrite both the checkpoint archive and its live ledger anchor can replace both, so repositories that require adversarial authenticity must also protect history with signed commits or an external append-only store.

Package consumers can import `SprintCloseCheckpointV1`, `SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION`, `SPRINT_CLOSE_CHECKPOINT_KIND`, and `SPRINT_CLOSE_TRANSACTION_STATUS` from the supported `kyro-ai` entrypoint.

## Project scope status on close

`projectScopeAfter.status` is derived with the same rule as `repair` / `status` / `analyze` (`deriveScopeStatus` on the intended-after sprint with `activeSprint` cleared):

| After-close roadmap | `projectScopeAfter.status` |
| --- | --- |
| Non-empty and every sprint `state === 'closed'` | `completed` |
| Non-empty with at least one non-closed sprint (intermediate close) | `planning` |
| Empty array (pathological / hand-edited; tool-owned `kyro plan` rejects empty roadmaps) | `planning` |

Sprint-level `intendedAfterClose.status` is a separate field and is **not** rewritten by this rule.

### Historical intermediate residual (checkpoint v1, 4.19.0–4.43.0)

From the introduction of lossless checkpoints through 4.43.0, intermediate closes **copied** `projectScopeBefore` into `projectScopeAfter`, leaving residual `status: "active"` even though live repair correctly normalized the scope to `planning`. Checkpoints have no writer-version field; the residual is recognized by **shape**:

- `schemaVersion === 1`
- `intendedAfterClose.activeSprint === null`
- at least one non-closed roadmap sprint
- `projectScopeAfter.status === 'active'`
- re-deriving under current rules yields the same entry with `status: 'planning'` only

Read-time behavior (no archive rewrite):

- `validateSprintCloseCheckpoint` accepts that residual as a historically authorized transition.
- `kyro doctor --artifacts` treats live scope equal to `{ ...projectScopeAfter, status: 'planning' }` as the applied after-image and reports a legacy note (`active→planning`).
- Immutable checkpoint bytes and ledger commitments are never rewritten for compatibility.
- Arbitrary live drift (title, id, other statuses) remains `DIVERGED`.

## Recovery states

`kyro doctor --artifacts` reports each checkpoint independently, even when live `sprint.json` is missing or invalid:

| State | Meaning |
| --- | --- |
| `PREPARED` | Checkpoint exists; live state still matches the before image. |
| `PARTIAL` | Some artifacts or live mutations were applied; retry the same frozen close inputs. |
| `APPLIED` | Artifacts and live state match the intended after image. |
| `DIVERGED` | Live or artifact content matches neither protected state; reconcile manually. |
| `CORRUPT` | Checkpoint structure, identity, or digest is invalid. |
| `UNSUPPORTED_VERSION` | The installed Kyro runtime cannot interpret the checkpoint. |

Retries are compare-and-swap operations under the same renewable, token-owned state-writer lease used by other Kyro mutators. The heartbeat runs independently of the main thread; renewal failure fail-stops the owning process before another writer may reclaim the lease. Missing `sprint.json` or the affected project scope entry can be restored to the intended-after image; unrelated current project fields are preserved. Invalid or divergent content and conflicting archive files are never overwritten. Managed scope, archive, lock, and reclaim paths must stay inside the workspace and cannot traverse symlinks.

Before each renewal Kyro verifies the real lock-directory inode, exact owner record, owner token, and unexpired heartbeat with no-follow file reads; it repeats those checks immediately before publishing through an exclusive, unpredictable temporary file. JavaScript renewal errors, uncaught exceptions, and rejected promises fail-stop the owner from the heartbeat worker. Unexpected worker exit is also fenced by parent handlers when the event loop is schedulable, while every protected mutation independently rejects missing/replaced ownership. This is a user-space filesystem lease, not protection against kernel/filesystem corruption, whole-machine suspension, or an attacker with authority to replace directory entries in the final check-to-rename interval; environments requiring that boundary need OS-level locking or a transactional external store.

Only the latest checkpoint is compared with current live state. Older checkpoints are historical records: doctor validates their schema, semantic transition, digests, artifacts, and ledger identity without treating later sprint evolution as divergence.

## External consumers

Kyro Lens and other readers should prefer recognized checkpoint versions for historical scope views, then fall back to legacy ActiveSprint snapshots with an explicit limited-history label. This release documents the contract only; it does not modify the Kyro Lens runtime.
