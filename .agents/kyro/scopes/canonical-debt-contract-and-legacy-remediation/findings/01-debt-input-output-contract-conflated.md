# Debt input and output contracts are conflated

Summary: Kyro validates every raw debt as the strict seven-field canonical output type, while Lens intentionally accepts a narrower legacy input and normalizes it into that output type.

Severity: critical

Affected files: `src/cli/artifacts/schema.ts`; Kyro Lens `src/data/parse.ts`; Kyro Lens `src/domain/types.ts`.

Reproduction: load the historical D1 shape with a string origin and missing priority/target sprint. Lens rejects the present invalid origin but considers absent canonical fields legacy-readable; Kyro rejects every missing canonical field without a separate compatibility classification.

Expected behavior: both products distinguish canonical, legacy-compatible, remediation-required, and unsupported raw debts while preserving one exact canonical output shape.

Recommendation: introduce shared behavior-level golden vectors and separate raw compatibility classification from canonical write validation.
