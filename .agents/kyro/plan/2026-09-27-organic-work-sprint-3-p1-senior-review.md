# Sprint 3 P1 Senior Review and Remediation Plan

Scope: `organic-work`; active Sprint 3, Phase P1 (`T3.1` and `T3.2`). This is an owner code review, not independent Kyro QA. Do not advance to P2 until the blocking findings are corrected and re-reviewed. Preserve all existing user and Sprint 1/2 changes. All Kyro task/evidence/review state changes must use the CLI.

## Verdict

Changes required before P2. The targeted amendment fixture passes, but it does not cover two counterexamples against T3.2's exact-byte and fail-closed acceptance criteria.

## Finding P1-1: An out-of-band edit can be accepted as crash recovery (major)

### Problem

`amendWorkBrief` treats `currentBytes === input.briefText` as sufficient proof that a previous CLI publication was interrupted. No durable transaction record distinguishes that condition from a manual or foreign edit of `brief.md`.

### Evidence

`src/cli/work/store.ts:117-120` sets `recoveredBrief = true` solely from byte equality. In an independent disposable-workspace probe, replacing the Work brief outside the CLI with the desired amendment bytes caused `work status` to report `resolve_blocker`; the subsequent `work amend-brief` exited 0, advanced revision 1 to 2, and returned the Work to `plan_tasks`. No interrupted CLI transaction existed.

### Expected result

An out-of-band brief mismatch must remain a blocker. Only an authenticated-to-this-Work, CLI-owned pending amendment from the current revision may be resumed. The operation must not represent two file writes as atomic.

### Required change

Design and implement a durable pending-amendment record before publishing the new brief. Bind it to the Work ID, expected revision, old and new brief digests, intended next Work digest or equivalent transition identity, actor, and reason. Validate that record and current file identities under the writer lock before a retry. Handle crashes before publication, between brief and Work writes, and after Work publication but before cleanup. If safe recovery cannot be proved, fail closed and expose an explicit repair path; do not infer recovery from equal bytes alone. Keep Work v1's exact `work.json` keys unchanged.

### Scope and restrictions

`src/cli/work/store.ts`, the Work command boundary if needed, and targeted regression fixtures. Do not accept arbitrary mismatches, mutate Forge state, or hand-edit managed Work files. Do not remove the expected-revision gate or the existing path/lock checks.

### Validation

Add a negative end-to-end fixture that performs a manual brief replacement with the proposed bytes and confirms `amend-brief` rejects it without changing `work.json`. Add injected-failure retries for each publication boundary, including stale or conflicting pending records, and confirm readers never expose a stale pass.

## Finding P1-2: Invalid UTF-8 source bytes are silently rewritten (major)

### Problem

`amendBrief` decodes the source with `readFileSync(source, 'utf8')`. Malformed UTF-8 is replaced during decoding; the CLI then hashes and publishes the replacement text, so the stored brief is not an exact copy of the source.

### Evidence

`src/cli/commands/work.ts:303-314` does not validate UTF-8 losslessness. A disposable-workspace probe passed a source containing byte `ff`: the command exited 0, but the stored brief contained UTF-8 replacement bytes `ef bf bd` instead. This contradicts T3.2's exact-source-byte criterion.

### Expected result

Only valid UTF-8 briefs may be accepted; every accepted brief's bytes and SHA-256 digest must equal the source bytes. Invalid UTF-8 must fail before any Work write.

### Required change

Read the bounded source as bytes, validate UTF-8 with a fatal decoder or equivalent round-trip check, and derive the title/objective from the validated text. Pass the original bytes or proven byte-identical text through the publication path. Keep the size bound byte-based and reject unreadable or unsafe source files.

### Scope and restrictions

`src/cli/commands/work.ts`, `src/cli/work/store.ts` if the API should accept bytes, and targeted fixtures. Do not normalize line endings or silently replace invalid characters.

### Validation

Add a malformed UTF-8 fixture that fails without changing either file, plus valid Unicode, CRLF, and non-ASCII fixtures that verify source/stored byte equality and digest equality after apply and retry.

## Finding P1-3: Preview fixture does not prove read-only behavior (minor test defect)

`scripts/check-work-amend.mjs:176` snapshots the Work after preview and compares it with itself. Move the snapshot before the preview, then compare both `work.json` and `brief.md` against that pre-preview state. Retain the existing no-op/stale and injected-failure fixtures.

## Review sequence

1. Agree on the recovery design and materialize a bounded corrective Kyro task or fail the affected T3.2 review through the CLI; keep P2 paused.
2. Implement the corrections in a new worker execution pass with fresh task context. Record truthful validation and refresh the affected Kyro evidence/review.
3. Owner re-probes the two counterexamples and reviews the diff, tests, and state. Only then decide whether to begin P2.
4. Independent Kyro QA remains a separate user-authorized gate after the sprint implementation, not part of this P1 review.
