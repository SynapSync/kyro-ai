# 01 — endCommit must be a frozen close input

- **Severity:** high
- **Affected:** `src/cli/checkpoints/sprint-close.ts` (`deriveSprintCloseTransitionWithPolicy` :200-222, re-derivation :282-300), `src/cli/commands/close-sprint.ts` (`buildClosePlan` :152, `buildCloseInputs` :482, `retryCloseInputs` :464, `assertMatchingCloseInputs` :547), `src/cli/types.ts` (`SprintCloseInputs` :387, `LedgerEntry` :351)
- **Behavior:** checkpoint verification re-derives `intendedAfterClose` from `beforeClose`, `close`, `createdAt` and paths and compares canonically; retries rebuild close inputs from CLI args and require canonical equality.
- **Recommendation:** capture `{ branch, endCommit, dirty }` in `buildClosePlan` before any write and store it as optional `close.git`; `retryCloseInputs` copies `checkpoint.close.git`; derive `ledger[].git` only from `beforeClose.activeSprint.git` + `close.git`; absent inputs ⇒ no `git` key (byte-identical to today).
- **Validation:** re-derivation of new and legacy checkpoints; retry after HEAD advances keeps original `endCommit`; existing `check:lossless-checkpoints`, `check:replay-witness`, `check:close-policy-compatibility`.
