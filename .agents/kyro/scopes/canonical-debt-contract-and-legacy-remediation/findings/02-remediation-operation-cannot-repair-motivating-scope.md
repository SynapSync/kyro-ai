# The remediation operation cannot repair the motivating scope

Summary: `debt.origin.set` is the only registered operation, but the planner requires the projected state to satisfy fields that the operation cannot add.

Severity: critical

Affected files: `src/cli/remediation/protocol.ts`; `src/cli/remediation/plan.ts`; `src/cli/artifacts/schema.ts`.

Reproduction: apply an origin-only projection to the real legacy D1 shape. Origin becomes numeric, but priority and targetSprint remain absent, so strict post-state validation rejects the plan before R-001 can be created.

Expected behavior: one typed, full-debt-preconditioned operation can produce an exact canonical debt after-image without rewriting historical evidence.

Recommendation: add a new versioned `debt.canonicalize` operation and a read-only preparation path requiring explicit operator values.
