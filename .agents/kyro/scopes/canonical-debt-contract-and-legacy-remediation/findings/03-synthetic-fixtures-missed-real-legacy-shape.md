# Synthetic fixtures missed the real legacy shape

Summary: remediation and Kyro-to-Lens tests begin with an otherwise canonical debt and corrupt only origin, so they cannot expose the missing-field contradiction.

Severity: high

Affected files: `scripts/check-sprint-doctor-v4.mjs`; `scripts/check-scope-remediation.mjs`; `scripts/check-verification-states.mjs`; Kyro Lens remediation contract tests.

Reproduction: compare the synthetic debt fixture with D1 and its two checkpoint variants. The fixture already has priority, targetSprint, and note; the historical data does not.

Expected behavior: a minimized fixture preserves the decisive original key/type shapes, and a release gate fails if those sentinel conditions disappear.

Recommendation: add shared original-shape vectors, mutation tests, and a temporary-copy acceptance probe against the actual local scope.
