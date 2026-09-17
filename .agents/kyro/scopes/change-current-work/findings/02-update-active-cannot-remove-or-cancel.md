---
summary: plan --update-active cannot remove a requirement or cancel a task in the same request
severity: HIGH
---

# Case 1 gap

`src/cli/core/active-plan.ts` can update requirement/scenario/task fields together, invalidate affected verdicts, and keep evidence. It cannot remove a requirement. Task cancel is a separate `record-evidence --disposition`. A scenario cannot change its requirement identity.

**User-visible:** “Corrige este requisito y ajusta sus tareas” still needs extra commands or a workaround sprint.

**Recommendation:** Extend `--update-active` with in-band requirement remove (atomic with relink/cancel of live consumers) and task cancel (`cancelled` + reason). Same digest ceremony as Plan 14.

**Validation:** One request changes R1 + consumer tasks; unrelated pass survives; evidence remains; remove without relink writes nothing.
