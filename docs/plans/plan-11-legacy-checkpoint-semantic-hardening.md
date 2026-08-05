# Plan 11 — Legacy checkpoint semantic hardening

> **Status:** Implemented and locally certified; remote delivery remains authorization-gated.
>
> **Branch:** `feature/intermediate-close-scope-status`
>
> **Release target:** `4.43.1` (unchanged; the candidate has not been published).
>
> **Origin:** Plan 10 post-implementation QA found that the legacy compatibility predicate accepted a self-consistent checkpoint shape that historical checkpoint v1 writers could not produce.

## 1. Outcome

Keep Plan 10's read-time compatibility for authentic v1 intermediate checkpoints while rejecting coordinated semantic changes to the stored project scope transition.

Certification succeeds only when the compatibility predicate represents the exact historical write shape:

```text
projectScopeBefore.status = active
projectScopeAfter = exact copy of projectScopeBefore
canonical new transition = projectScopeAfter with status planning
```

## 2. Verified defect

Before this remediation, `isLegacyIntermediateActiveScopeAfter` checked the stored after status plus matching `id` and `title`, but it did not require:

1. `projectScopeBefore.status === active`.
2. Full canonical equality between `projectScopeBefore` and the historical copied `projectScopeAfter`.

A checkpoint with `projectScopeBefore.status = blocked` and `projectScopeAfter.status = active` was therefore accepted after recomputing its internal digest and ledger commitment. Historical v1 could not emit that transition because its intermediate path returned `{ ...projectScopeBefore }` unchanged.

## 3. Invariants

### 3.1 Authentic legacy residual

The legacy soft-match is allowed only when all Plan 10 conditions hold and:

- the before entry is `active`;
- the stored after entry is canonically identical to the before entry;
- re-derivation under 4.43.1 produces the same entry with only `status: planning`.

This preserves custom scope-entry fields if historical files contain them. Comparing only known fields is insufficient because v1 copied the complete entry.

### 3.2 Fail-closed behavior

Any change to the historical before/after relationship remains an unauthorized transition even when an actor recomputes:

- `digests.projectScopeBefore`;
- the external ledger `checkpointSha256` commitment;
- `digests.intendedAfterClose`.

No checkpoint is rewritten or migrated.

## 4. Work units

### Work unit A — Predicate and regression

1. Tighten `isLegacyIntermediateActiveScopeAfter` to require an active before entry and canonical before/after equality.
2. Add a checkpoint-level negative regression based on the frozen legacy fixture.
3. Recompute the modified test checkpoint's self-consistency fields so the assertion proves semantic rejection rather than a basic digest failure.
4. Keep the behavior and its test in the same commit unit.

### Work unit B — Documentation reconciliation

1. Mark Plan 10 as implemented, then locally certified only after Plan 11 passes.
2. Check only Plan 10 acceptance criteria supported by evidence.
3. Record the exact historical-copy invariant in the checkpoint contract and changelog.
4. Remove accidental trailing whitespace from versioned documentation.
5. Preserve the frozen fixture bytes; its trailing space is historical evidence, not editable prose.

## 5. Acceptance criteria

- [x] Authentic frozen v1 intermediate checkpoint with live `planning` remains `APPLIED`.
- [x] Doctor and repair do not rewrite the frozen checkpoint.
- [x] A self-consistent `blocked → active` checkpoint is `CORRUPT` as an unauthorized transition.
- [x] New intermediate closes continue to write `planning`.
- [x] Final and empty-roadmap behavior remain unchanged from Plan 10.
- [x] CAS/resume remains fail-closed.
- [x] Plan 10 and public checkpoint documentation state the exact compatibility boundary.
- [x] `git diff --check` is clean; `.gitattributes` documents the immutable fixture byte exception.
- [x] `npm run check`, adapters, token audit, clean-export artifact check, and package dry-run pass.
- [x] NutriLens passes `doctor --artifacts` with the local 4.43.1 candidate.

## 6. Validation order

```bash
OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf npm run build
OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf npm run check:lossless-checkpoints
OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf npm run check
OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf npm run check:adapters
OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf npm run check:tokens
npm pack --dry-run
```

Run `check:artifacts` in a clean exported checkout because this repository's ignored `.agents/` contains an unrelated incomplete `demo` scope. Verify NutriLens with this repository's local `dist/cli.js`, not npm `@latest`.

## 7. Certification evidence

| Gate | Result |
| --- | --- |
| Regression before predicate fix | RED: the coordinated `blocked → active` checkpoint was incorrectly `APPLIED` |
| Regression after predicate fix | PASS: the same checkpoint is `CORRUPT` with an unauthorized-transition finding |
| `npm run check` | PASS, including 29/29 behavioral evals |
| Adapters / tokens / package dry-run | PASS |
| Clean-export `check:artifacts` | PASS with no project state, avoiding the unrelated ignored `demo` scope |
| NutriLens local candidate | `APPLIED`, scope `planning`, `nextAction: plan_sprint` |
| NutriLens checkpoint SHA-256 | `5bcebbd8d23cf66e1fd9603dc7c4f0ad6e483fb67e7ed81e115ee51f151f891a` before and after Doctor |

The installed global runtime remains 4.43.0; all 4.43.1 consumer evidence uses this checkout's local candidate.

## 8. Delivery boundary

This plan authorizes local code, tests, documentation, and validation on the current feature branch. Push, PR, npm publish, runtime synchronization, and consumer Sprint 2 planning remain separately authorization-gated.
