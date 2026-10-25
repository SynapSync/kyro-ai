# Close Validation Protocol (Forge)

Proportional to the sprint's change. The aggregate (`integration`) runs at the integration boundary, and at close only when declared in `close`, escalated, or justified.

1. **Reconcile first.** Find the sprint's changes with git: `git status --porcelain` (untracked included) plus the sprint's commits — identify them (e.g. since the sprint's plan date or a known base) and state the method; date-based selection is an approximation and a clean tree hides committed changes. Pass every missing path (new, deleted, both sides of renames) with `{{KYRO_CLI}} context-pack --kyro-scope <scope> --json --sprint-file <path>` and re-read the pack. Reconciliation only adds files, so selection may include extra checks.
2. **Run** `validation.sprint.commands`, plus task-created checks from `validation.sprint.evidenceCandidates` that still apply to the final state (they are free text — verify the current command), plus focused checks for `validation.sprint.uncoveredFiles`. Reuse results whose tested state is still valid (`protocols/validation.md`); rerun what later changes invalidated.
3. **Broaden with reason.** `escalated: false` only means no `escalate` pattern matched. Cross-cutting changes outside it (shared types, public contracts, auth, dependencies, build/install) broaden up to `integration`. No map: select from criteria, diff and project scripts; broaden for high-impact changes or state the limitation. `escalationUnconfigured` never counts as validation.
4. **Record** in `close-sprint --note`: reconciliation method and uncertainty, what ran, what was reused, `uncoveredFiles`, escalation reasons, and exactly one integration status:
   - `ran at close`;
   - `satisfied by reused evidence` (with the tested-state reference);
   - `deferred to <integrationBoundary>` (only when a named mechanism exists);
   - `not configured` (`integration: []`; never satisfies an escalation);
   - `pending: no integration mechanism identified` (with the real boundary, e.g. before release).

A failing selected command blocks close until fixed or explicitly carried as debt.
