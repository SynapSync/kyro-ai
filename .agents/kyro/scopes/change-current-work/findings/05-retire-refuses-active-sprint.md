---
summary: scope retire refuses while activeSprint is set; discard is a three-gate chain
severity: HIGH
---

# Case 4 gap

`src/cli/checkpoints/scope-retirement.ts:416-417` refuses retire while a sprint is active. `close-sprint --outcome abandoned` already exists for partial sprints. The user path is dispose remaining → abandoned close → retire, surviving every gate.

**User-visible:** “Ya no necesito este scope” becomes an approval chain.

**Recommendation:** `scope discard` preview/apply that orchestrates existing writers (cancel undisposed → abandoned close → retire) under one digest/yes. No new WAL. Retry the same digest. Standalone close/retire unchanged.

**Validation:** Discard a live scope with undisposed tasks; inspect shows abandoned close + retired; doctor --artifacts clean; prior archives unchanged.
