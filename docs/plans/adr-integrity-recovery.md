# ADR — Integrity recovery without a new public surface

**Status:** Accepted for 4.47.0 (local implementation; no release authorization).

**Context:** A real NutriLens checkout fails `doctor --artifacts` for registry drift, 11 legacy checkpoints whose identity/transition/snapshot/narrative are reproducible, and one post-close live divergence. Existing `scope retire` and `remediate` require healthy physical checkpoints. Routers forbid hand-edit.

## Decision

1. One public path: `/kyro:forge` recover mode. Six slash commands. Twenty-six root CLI verbs.
2. Internal composer: `kyro repair integrity prepare|apply`. Not new roots.
3. Closed typed operations: `registry.register-on-disk`, `registry.unregister-orphan`, `checkpoint.canonicalize`, remediations v4 `convention.append`, `adr.append`, and `ledger.checkpoint.reanchor`.
4. Checkpoints, snapshots, and narratives are never rewritten. Canonicalization is an append-only overlay bound to the original file SHA-256.
5. `resolveEffectiveCheckpoint` is the single interpretation used by doctor, ledger refs, retire, remediations, and recertify. Canonicalized evidence is labeled `CANONICALIZED`.
6. Remediation protocol gains writable revision 4 only when a batch contains a new kind. `CURRENT` stays 2.
7. Crash safety is resume-or-`DIVERGED`: exclusive integrity-repair warrant first, then per-operation exclusive publish + CAS. No multi-file rollback engine.

## Invariants

- Validators are not weakened. Ambiguous or contradictory history stays `CHECKPOINT_CORRUPT`.
- One human approval binds the exact targets and values via a SHA-256 digest.
- `local.json.activeScope` is cleared only when it names an unregistered orphan.
- The real consumer checkout is never mutated by this work.

## Consequences

- Forge happy path runs a silent prepare; empty findings add no user step.
- Older Kyro cannot execute v4 remediations records (`UNSUPPORTED_VERSION`).
- Interrupted apply leaves valid prefix artifacts and is finished with the same digest, or refused if live state is a third value.
- Apply looks up an existing integrity-repair warrant before recomputing a plan. The same digest resumes remaining exclusive publishes; it does not `DIVERGED` after a successful prefix.
- `unsupported`, `diverged`, `irreconcilable`, and identity conflicts are explicit blockers. Empty findings means healthy.
- Overlay `recordCommitment` and `previousChainHead` are verified. Effective checkpoints are rebuilt from original bytes, never trusted from a stored projection.
- Forge runs integrity prepare before scope resolution or `context-pack`.
- Remediations v4 apply through one transactional primitive. `ledger.checkpoint.reanchor` only accepts an effective or originally observed commitment, including via `kyro remediate`.
