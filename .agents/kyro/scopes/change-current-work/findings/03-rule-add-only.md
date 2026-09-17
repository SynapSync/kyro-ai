---
summary: Source on this branch only supports rule add; a stale local rule cannot be replaced
severity: HIGH
---

# Case 2 gap

`src/cli/commands/rule.ts` on `36c3897` accepts only `add`. A wrong local convention stays effective forever. Workaround: add a second rule (both apply) or hand-edit JSON.

**User-visible:** “Esta regla ya no aplica; reemplázala” has no verb.

**Recommendation:** Scope-local `rule update|remove|replace`. No `--global` in this scope. Effective packs must drop the old id; local history keeps the old text.

**Validation:** replace process-1 → process-2; context-pack/full/task packs omit process-1; doctor clean.
