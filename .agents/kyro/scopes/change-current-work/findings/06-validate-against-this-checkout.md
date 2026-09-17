---
summary: PATH kyro 4.50.0 already carries Plan 15 revise; this branch does not
severity: HIGH
---

# Runtime skew

`kyro capabilities --json` on PATH advertises `plan.revise` and schema 5. This git branch (`plan/agent-unblock` @ `36c3897`) has no `revision.ts`. Implementing and testing this scope against `~/.agents/kyro/current` would mix Plan 15 behavior with Plan 16 source.

**User-visible:** False greens, or schema-5 records in a schema-4 plan.

**Recommendation:** Build and invoke the CLI from this checkout for all mutating proofs. Do not treat the globally installed candidate as the SoT for this scope.

**Validation:** Checks spawn an explicit absolute path to this repo’s built `dist/cli.js` (guarded probe helper if the check is mutating).
