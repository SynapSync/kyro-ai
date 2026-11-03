# 02 — activeSprint/ledger rewriters must preserve the git block

- **Severity:** medium
- **Affected:** writers of `activeSprint`/`ledger` including `src/cli/core/active-plan.ts`, `src/cli/commands/{record-evidence,review,add-emergent,scenario,clarify,debt,rule,repair,scope}.ts`, `src/cli/repair/integrity-plan.ts`, `src/cli/remediation/{plan,certification-plan}.ts`, `src/cli/checkpoints/{scope-completion,scope-reopen,scope-retirement,lifecycle-state}.ts`, `src/cli/migrations/legacy-sprints.ts`, `src/cli/work/promotion.ts`
- **Behavior:** validators tolerate unknown keys, but any writer that rebuilds `activeSprint` or ledger entries field-by-field would silently drop `git`.
- **Recommendation:** audit each writer; preserve via spread or explicit copy; add a preservation test for the highest-traffic writers (active plan update, record-evidence, review, repair).
- **Validation:** sprint with `activeSprint.git` survives each audited mutation unchanged.
