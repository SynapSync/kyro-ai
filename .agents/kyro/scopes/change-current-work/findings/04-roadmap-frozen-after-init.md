---
summary: Roadmap is written at plan init and not editable afterward
severity: MEDIUM
---

# Case 3 gap

`src/cli/commands/plan.ts` writes `roadmap` at init and sets `state: active` on materialization. There is no later writer for planned title/add/cancel/reorder.

**User-visible:** “Reorganiza los próximos sprints” means a new scope or a hand-edit.

**Recommendation:** Dedicated `plan --roadmap` for `state: planned` only. Do not renumber closed/active `n`. Presentation reorder ≠ execution identity.

**Validation:** Cancel planned n=4; closed sprint-001 identity and archive untouched.
