# Plan 14 — Controlled Updates to Active Tasks

> **Status:** Implemented and validated locally; full regression suite and package dry-run passed. Not installed or released.
> **Baseline:** Kyro 4.49.4, commit `fa52530`.
> **Approved direction:** Extend the existing `plan` command; keep every managed-state write tool-owned.
> **Supersedes:** The initial proposal to permit direct edits of `sprint.json`. The user explicitly selected controlled updates instead. No editor-hook exception is being implemented.

## 1. Decision

```text
open scope + current unclosed sprint
  → agent edits an input document
  → plan --update-active previews the diff
  → confirmed apply under Kyro's writer lock
  → revalidate affected tasks → record evidence → review → continue

closed scope / closed sprint / archive
  → refuse historical task edits and explain why
```

A task's `done` state or previous approval alone does not make active work immutable. Conversely,
an open or reopened scope does not make its previous closed sprints editable. `activeSprint.status:
complete` describes completed task execution, not archival.

The agent never edits `sprint.json` directly. Existing Claude hooks, managed-write contracts, task
states, schema v4, capabilities and top-level commands remain unchanged.

## 2. Explicit existing-command interface

```bash
kyro plan --update-active --from update.json --kyro-scope example --dry-run --json
kyro plan --update-active --from update.json --kyro-scope example --digest <preview-digest> --yes --json
```

Default init/next-sprint `plan` behavior is preserved, including `SPRINT_ALREADY_ACTIVE`. Update mode
is explicit; it never silently reinterprets a normal next-sprint input as a revision.

Input example:

```json
{
  "sprint": { "n": 3, "slug": "authorization-boundaries" },
  "reason": "Separate preparation authorization from destructive-operation authorization.",
  "tasks": [
    {
      "id": "T3.3",
      "context": "Preparation and destructive actions require separate approvals.",
      "acceptance_criteria": [
        "Preparation requires explicit authorization.",
        "Destructive actions require a later explicit authorization."
      ]
    }
  ]
}
```

- Task fields: `title`, `description`, `context`, `acceptance_criteria`, `files_to_touch`, `depends_on`,
  `scenario_refs`. Arrays replace the complete field; removed criteria are visible in the diff.
- Optional active `requirements` and `scenarios` definitions can be updated/added. Existing scenario
  requirement links cannot be repurposed. Historical definitions are retained; new active behavior
  may use a new requirement/scenario identity without creating a new task.
- Existing task IDs/membership, status, evidence, verdict, disposition, ledger, debt, project state,
  lifecycle and certification anchors are not editable input.
- Requirements/criteria may evolve only with the appropriate user approval and project principles;
  the CLI cannot prove semantic equivalence of prose or human consent.

## 3. Core invariants

1. Require an open canonical scope and consistent registry identity, with the exact current sprint
   and task IDs. No automatic historical task restoration or scope reopen.
2. Refuse a current/later close checkpoint, a closed ledger identity, historical artifacts for the
   current sprint, a terminal parent, an unsafe managed path or ambiguous/corrupt historical state.
3. Verify historical consumers through checked checkpoints/legacy snapshots. Missing history is not
   proof of absent consumers. Legacy history without sufficient mapping cannot authorize rewriting
   an existing shared definition.
4. Validate resulting shape, unique IDs, dependency DAG, references and project gates before writing.
5. Compute affected task/spec consumers and transitive dependents from both the old and new graphs.
   Removing an edge must not hide previous impact.
6. Atomically clear affected current verdicts and return affected `done` tasks to `pending` together
   with the definition changes. Retain previous evidence for reference; it is not current approval.
7. Preserve pending/in-progress statuses, unaffected task records and every historical artifact.
   A disposition is not removed or implicitly reactivated by editing a definition.
8. Recompute derived phase/sprint states and handoff within the same live write. Update timestamp is
   stamped at apply; preview does not create timestamps, locks, traces or other state files.
9. Apply re-reads under the existing state-writer lease and checks the digest over state, normalized
   input, policy, principles, scope registry entry and inspected history. Stale approval is refused.
10. Only `sprint.json` is committed, via the existing durable atomic replacement helper. No new
    journal, request receipt or per-task revision store is introduced. Trace is diagnostic only.

## 4. Verification behavior

- Implementation-only correction: use existing `review --verdict fail` and repeat execution,
  validation, evidence and review on the same active task ID.
- Definition correction: `plan --update-active` owns approval invalidation; do not perform a separate
  state-changing review between preview and apply.
- Live readers compare an existing `reviewedMaterialDigest` to current material, expose stale passes
  as review debt and block close. Old applied review digests cannot masquerade as current approval.
- Preserve the canonical v1 digest encoding and legacy verdict read compatibility. Historical replay
  must not be reinterpreted with a new live-review rule. No mass recertification of unchanged tasks.
- Digests cover task metadata/evidence, not source bytes or scenario bodies. Workflow invalidation
  precedes product changes; update mode explicitly invalidates affected shared-spec consumers.
- Repeat relevant tests, not automatically the entire product suite for each note change.
- Existing task review stays required. Optional QA is repeated only when previous audited material
  changed or existing policy requires it; editing alone does not create optional certification.
- Carry known re-QA obligations in the update reason/handoff and subsequent existing evidence notes.
  Recover prior reports or ask after context loss; do not invent an approval or an exemption. Notes
  are not a machine-enforced QA certificate. Do not repurpose `recertify` for ordinary task edits.

## 5. Files and responsibilities

| Surface | Implementation |
| --- | --- |
| `src/cli/core/active-plan.ts` | Strict input, parent/history guards, change/impact preparation and single-file locked apply |
| `src/cli/commands/plan.ts`, `src/cli/help.ts` | Explicit update flags, preview/apply envelopes and help; default planning unchanged |
| `src/cli/core/task-graph.ts` | Shared non-recursive cycle/identity validation; spec-reference decisions remain in analysis; not a scheduler |
| `src/cli/core/digest.ts` | Existing canonical hash encoding extracted without changing historical commitments |
| `src/cli/checkpoints/sprint-close.ts` | Re-export existing hash APIs for compatibility; retain durable write/recovery semantics |
| `src/cli/core/review-material.ts` | Shared v1 material digest and live freshness predicate |
| `src/cli/core/analysis.ts` | Blocking stale-review/cycle findings |
| `src/cli/commands/review.ts` | Fresh material binding on review and noop handling |
| `src/cli/commands/context-pack.ts`, `src/cli/commands/status.ts` | Consistent stale-review debt/current-approval reporting |
| `internal/skills/sprint-forge/assets/helpers/active-plan-update.md` | One lazily loaded canonical update procedure |
| Forge/orchestrator/executor modes | Discover active updates, retain CLI ownership, revalidate/review and preserve applicable QA |
| `scripts/check-active-plan.mjs`, `package.json` | Focused fixture, concurrency, failure-boundary and historical-protection tests in the standard suite |
| `docs/cli.md`, maker/checker, guardrails, context and architecture docs | Accurate interface, rework boundaries and failure semantics |
| `CHANGELOG.md` | Unreleased behavior; no release/version bump or installation implied |

No edits to the CLI dispatcher, public command wrappers, MCP catalog, capabilities list or editor
hooks are needed. Input documents are not a second source of truth; only the committed sprint is.

## 6. Test matrix

| Case | Expected result |
| --- | --- |
| Pending task in active sprint | Editable; pending state and identity preserved |
| In-progress task in active sprint | Editable; in-progress preserved; no new optional QA |
| Existing emergent task | Same collection and identity retained; unrelated custom metadata preserved |
| Done/pass task under active parents | Same-ID update clears approval, returns to pending and requires fresh checks/review |
| Meaningful task/spec edit | Old/new consumers and transitive dependents invalidated; unrelated records untouched |
| Task in closed sprint under open scope | Refused without changing historical bytes |
| Task in completed/retired scope | Refused; no implicit scope reopening |
| Archived/shipped task | Refused even if another sprint is active |
| Reopened scope | Old tasks stay historical; only new active tasks can be updated |
| Historical update request | Explain closed parent; never suggest a direct editor bypass |
| Prepared/interrupted close | Refuse updates and direct to existing recovery |
| Prior QA / no prior QA | Repeat affected known QA only; do not introduce optional certification |
| Missing/ambiguous QA context | Recover report or ask; never fabricate approval |
| Invalid fields, duplicate/unknown IDs, missing refs, empty criteria or cycles | Refuse with no state writes |
| Historical shared definitions / unverifiable consumers | Refuse rewrite; retain old identity |
| Disposed task | Definition change does not remove disposition or revive execution |
| Preview repeated | Deterministic digest/diff; zero workspace writes |
| State/input/policy changed after preview | Old digest refused |
| Two concurrent apply processes | One commits; the other rejects its stale base |
| Failure before atomic rename | Original state intact; no success reported |
| Failure after atomic rename | Complete new definition plus invalidation, never half-state or false success; inspect/re-preview |
| Existing input already matches | Fresh preview/apply is noop |
| Evidence/material changed after pass | Analyze/pack/status expose stale review; close blocked |
| Applied review digest replayed against changed material | Refused, not current approval |
| Unchanged legacy review | Remains readable; supported edits still invalidate it |
| Unsafe live path or symlink | Refused without modifying target |

Deterministic CLI tests verify state behavior; prose checks do not prove agent compliance. Manual
host trials should additionally confirm historical-refusal explanations and prior-QA handling.

## 7. Validation and delivery

Targeted checks passed during development (`check:active-plan`: 16 groups, including multi-hop dependents, preserved dependent routing, concurrent processes and injected rename-boundary failures):

```bash
npm run build
npm run check:active-plan
npm run check:maker-checker
npm run check:record-evidence
npm run check:plan
npm run check:status
```

Final full verification passed:

```bash
npm run build
npm run check
npm pack --dry-run
```

Verification used temporary fixtures, not live consumer sprints. The unchanged direct-write guard,
lossless-checkpoint/lifecycle replay and compatibility regressions passed. The full suite includes
31/31 fixture-based behavioral evals; these are not model-driven host trials. Token budgets passed
without increased ceilings (two warnings remain). Package inspection confirmed the compiled updater,
shared review helper and workflow helper are included. `git diff --check` passed.

No runtime installation, release, version bump or mutation of an actual active scope was performed.
The preexisting `.agents/kyro/project.json` working-tree change was not part of this implementation.

## 8. Deliberately excluded

Historical task reopening, new lifecycle commands/states, direct editor access to managed state,
new per-task files, general JSON Patch, automatic optional certification, a second task history
store, transactional trace receipts, and automatic runtime installation.

An error after a durable rename may mean the entire update committed. The command never reports a
false success; re-read/re-preview to resolve ambiguity. An unchanged input is a no-op on the new base.
User-supplied prose is not semantic proof, trace is not authentication, and arbitrary filesystem
writes outside the CLI remain outside the supported contract.
