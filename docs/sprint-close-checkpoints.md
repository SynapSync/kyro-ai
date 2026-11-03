# Lossless sprint-close checkpoints

Every new sprint close publishes an immutable, versioned checkpoint before changing live scope state. This is the authoritative recovery artifact; the existing ActiveSprint JSON remains available for backward-compatible readers.

## Files written

| File | Contract |
| --- | --- |
| `sprint-NNN-slug.checkpoint.json` | Complete transaction record: full scope state before close and intended after close, affected project-state scope entry, frozen inputs, paths, and SHA-256 digests. |
| `sprint-NNN-slug.json` | Legacy verbatim `ActiveSprint` snapshot. It does not contain historical debt, spec, roadmap, handoff, or scope status. |
| `sprint-NNN-slug.md` | Deterministic human-readable narrative. |

`ledger[].checkpoint` and `ledger[].checkpointSha256` are additive; `ledger[].snapshot` remains unchanged. The digest in the live ledger is an external commitment to the checkpoint payload. Historical legacy archives are not backfilled because their missing scope fields cannot be reconstructed honestly.

## Sprint git range

From 6.5.0, each sprint records the git range that implemented it, so its code can be reproduced as `git diff <startCommit>..<endCommit>`.

| Field | Written | Content |
| --- | --- | --- |
| `activeSprint.git` | When the sprint is planned (`kyro plan`) | `{ branch, startCommit }` — HEAD and current branch (`null` when detached). |
| checkpoint `close.git` | At close, before any close write | `{ branch, endCommit, dirty }` — frozen input of the close transaction. |
| `ledger[].git` | Derived at close | `{ branch, startCommit, endCommit, dirty }`; `startCommit` is `null` when the sprint was planned without git capture. |

`endCommit` is a frozen close input, not post-close state: checkpoint re-derivation reproduces `ledger[].git` from `beforeClose.activeSprint.git` and `close.git`, and a retried close reuses the frozen value instead of reading HEAD again. `dirty` is `true` when tracked or untracked non-ignored files outside `.agents/kyro/` (and the root `.kyro-state-writer.lock*` paths) had uncommitted changes at close; those changes are outside the range. Capture is read-only (`git --no-optional-locks status`) and never blocks: outside a repository, before the first commit, or when git fails, the range is omitted and `plan`/`close-sprint` report why. Sprints closed before 6.5.0 are not backfilled.

**Forward compatibility.** Runtimes older than 6.5.0 do not know `close.git` and report a checkpoint that contains it as an unauthorized transition (a retry on such a runtime raises `CHECKPOINT_CONFLICT`). Existing checkpoints keep validating and re-deriving on 6.5.0; the reverse does not hold. Teams sharing scopes should set `team.minPackageVersion` to `6.5.0` or newer (see [Teams](teams.md#optional-team-package-floor)); a close that records `close.git` without that floor prints an advisory. Kyro never changes `project.json` for you.

The optional close commit (`git.commitOnSprintClose` in `local.json`) runs after the close and never changes checkpoint content; see [CLI — close commit](cli.md#sprint-close-git-range-and-optional-commit).

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

## Lifecycle verification trust boundary

Explicit scope completion and reopen may lawfully move live state beyond the most recent close
checkpoint. Kyro verifies that evolution by replaying only the lifecycle suffix not already sealed in
the checkpoint and by projecting `sprint.json` and the project registry together.

The governing invariants are:

- sprint close and scope completion remain separate decisions;
- live `completionHistory` must extend the sealed prefix exactly;
- request and prior-entry digests must re-derive before a suffix step can replay;
- both durable layers must exactly match one shared projection;
- immutable checkpoints, snapshots and narratives are never rewritten by lifecycle verification;
- the result proves structural consistency only — `by`, actor identity and writer-process identity are
  not authenticated.

All lifecycle bindings are plain SHA-256 values over public repository content. They support
idempotency, interrupted-write recovery and detection of incomplete or inconsistent edits. They
cannot distinguish the transactional writer from an editor who controls both durable layers and
recomputes every value. Authenticating that stronger claim requires a trust root outside those files,
such as signed repository history or an external append-only attestation service.

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
- `projectScopeBefore.status === 'active'`
- `projectScopeAfter` is canonically identical to `projectScopeBefore` (the complete v1 copy-before write shape)
- re-deriving under current rules yields the same entry with `status: 'planning'` only

Read-time behavior (no archive rewrite):

- `validateSprintCloseCheckpoint` accepts that residual as a historically authorized transition.
- `kyro doctor --artifacts` treats live scope equal to `{ ...projectScopeAfter, status: 'planning' }` as the applied after-image and reports a legacy note (`active→planning`).
- Immutable checkpoint bytes and ledger commitments are never rewritten for compatibility.
- Arbitrary live drift remains `DIVERGED`; a stored before/after relationship that v1 could not
  write remains `CORRUPT`, even when its internal digests and ledger commitment are recomputed.

## Recovery states

`kyro doctor --artifacts` reports each checkpoint independently, even when live `sprint.json` is missing or invalid:

| State | Meaning |
| --- | --- |
| `PREPARED` | Checkpoint exists; live state still matches the before image. |
| `PARTIAL` | Some artifacts or live mutations were applied; retry the same frozen close inputs. |
| `APPLIED` | Artifacts and live state match the intended after image, **or** the close remains ledger-anchored after legitimate post-close evolution (see below). |
| `DIVERGED` | Live or artifact content matches neither protected state and is not ledger-anchored evolution; inspect manually. |
| `CORRUPT` | Checkpoint structure, identity, or digest is invalid. |
| `UNSUPPORTED_VERSION` | The installed Kyro runtime cannot interpret the checkpoint. |

### Post-close evolution vs failed close

Tool-owned writers may mutate live `sprint.json` after a successful close (for example `kyro rule add`, debt, ADRs). That changes the live digest relative to `intendedAfterClose` without invalidating the close. When:

- snapshot and narrative digests still match,
- the project-scope entry still matches the after image (or the legacy intermediate `active→planning` normalization), and
- live `ledger[]` still anchors this checkpoint (path + `checkpointSha256`, closed roadmap row, no rewound active sprint),

doctor reports **APPLIED** with `sprint=after (post-close evolution)`.

`kyro repair` only normalizes derived **status** fields and pretty-prints JSON. It does **not** restore checkpoint after-images and must not be used to wipe intentional post-close mutations.

Retries are compare-and-swap operations under the same renewable, token-owned state-writer lease used by other Kyro mutators. The heartbeat runs independently of the main thread; renewal failure fail-stops the owning process before another writer may reclaim the lease. Missing `sprint.json` or the affected project scope entry can be restored to the intended-after image; unrelated current project fields are preserved. Invalid or divergent content and conflicting archive files are never overwritten. Managed scope, archive, lock, and reclaim paths must stay inside the workspace and cannot traverse symlinks.

Before each renewal Kyro verifies the real lock-directory inode, exact owner record, owner token, and unexpired heartbeat with no-follow file reads; it repeats those checks immediately before publishing through an exclusive, unpredictable temporary file. JavaScript renewal errors, uncaught exceptions, and rejected promises fail-stop the owner from the heartbeat worker. Unexpected worker exit is also fenced by parent handlers when the event loop is schedulable, while every protected mutation independently rejects missing/replaced ownership. This is a user-space filesystem lease, not protection against kernel/filesystem corruption, whole-machine suspension, or an attacker with authority to replace directory entries in the final check-to-rename interval; environments requiring that boundary need OS-level locking or a transactional external store.

Only the latest checkpoint is compared with current live state. Older checkpoints are historical records: doctor validates their schema, semantic transition, digests, artifacts, and ledger identity without treating later sprint evolution as divergence.

Remediations are replayed from the checkpoint boundary named by their `base.checkpoints`, including
records already sealed by a later close. Later valid closes advance that boundary in ledger order:
their before-image must preserve prior ledger entries, conventions and ADRs unchanged and retain
every prior debt item. Debt `id`, `title`, `origin` and any additional fields are immutable;
only `status`, `targetSprint`, `note` and priority escalation may change through normal debt
lifecycle work. A priority decrease requires an explicit typed remediation, not a later close.
Normal planning and execution may evolve within that sprint. The latest after-image, plus any later replayed remediations and explicit lifecycle
transitions, must exactly reproduce live state; an unexplained post-close edit remains `DIVERGED`.
This proves structural consistency with committed history, not actor authenticity.

## External consumers

Kyro Lens and other readers should prefer recognized checkpoint versions for historical scope views, then fall back to legacy ActiveSprint snapshots with an explicit limited-history label. This release documents the contract only; it does not modify the Kyro Lens runtime.
