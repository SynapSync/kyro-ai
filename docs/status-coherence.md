# Status Coherence

Kyro's `sprint.json` carries lifecycle status at several levels — `task.status`, `phase.status`,
`activeSprint.status`, and the project-state scope-status cache. Only `task.status` is authoritative;
the rest are **derived** from it. This document describes how Kyro keeps them coherent so a phase can
never silently read "pending" while all its tasks are "done".

## Derived status

`src/cli/core/status.ts` computes status from the authoritative leaf. It is a pure module (no I/O),
enforced by `check:status`.

| Function | Rule |
|---|---|
| `derivePhaseStatus(phase)` | no tasks → `pending`; any task `blocked` → `blocked`; all `done` → `done`; any `in_progress` or a done/pending mix → `active`; else `pending` |
| `deriveActiveSprintStatus(active)` | no tasks → `planned`; all tasks still `pending` → `planned`; all `done` → `complete`; else `executing` |
| `deriveScopeStatus(sprint, hasActiveSprint)` | `retirement` → `retired`; active sprint with a blocked task or `handoff.blockers` → `blocked`; active sprint → `active`; an explicit `completion` record, or `handoff.nextAction === 'done'` (legacy terminal read) → `completed`; else `planning`. Exhausting the original roadmap does not complete a scope. |

These three signals answer different questions:

| Signal | Meaning |
|---|---|
| Roadmap sprint `state: active` | Which roadmap slot is currently live |
| `activeSprint.status` (`planned` / `executing` / `complete`) | How far **task leaves** have progressed inside that sprint |
| `handoff.nextAction` | What the agent should do next (routing) |

So `activeSprint.status: planned` with `nextAction: execute_task` is **coherent**: the sprint is materialised and ready, but no task has started yet. `kyro status` human output prints a short gloss in that case so agents do not treat it as a bug.

`normalizeStoredPhaseStatus` maps historical vocabulary (`executing`/`in_progress` → `active`,
`complete`/`completed` → `done`) so vocabulary drift is not mistaken for real drift.

## Scope lifecycle: completion, reopen, retirement

Three distinct facts, never inferred from each other and never inferred from the roadmap:

| Fact | Written by | Effect |
|---|---|---|
| **Completion** — the work is done | `kyro scope complete` (confirmed) | `completion` record, `status: completed`, `nextAction: done`. Reversible by reopening. |
| **Reopen** — more work is needed | `kyro scope reopen` (confirmed) | clears `completion`, appends it to append-only `completionHistory` with the reason, `status: planning`, `nextAction: plan_sprint`. |
| **Retirement** — the scope leaves the lifecycle | `kyro scope retire` (human-approved, digest-bound) | `retirement` record, `status: retired`, terminal. Never reopened. |

`completionHistory` is audit evidence, not a status signal: a reopened scope derives `planning`
however many completions it has behind it, and the history stays readable through `kyro scope
inspect` and the context pack's `reopenHistory`. A completed scope refuses `kyro plan` with
`NOT_READY_TO_PLAN` and a remedy naming reopen, so the lawful route is the only route — a retired
scope is never offered it.

Because completion and reopen legitimately move live state off the close checkpoint's after-image,
`kyro doctor --artifacts` replays the recorded transitions from that image through the same builders
the writers use (`src/cli/checkpoints/lifecycle-state.ts`) and accepts live state only when the
replay reproduces it exactly. Records are evidence, never authority: a rewritten lifecycle record,
an inconsistent hand edit, or a corrupt immutable artifact still fails closed as `DIVERGED`.

Only the suffix a checkpoint has not already sealed is replayed, and only when its public structural
bindings re-derive from its content and prior registry state. Missing, stale, or partially rewritten
bindings fail closed; sprint and registry receive one atomic verdict. These hashes establish
consistency, not provenance: an editor controlling both layers can recompute them. `by` is
self-asserted, and no separation between the agent that completed a scope and the one that verified
it is enforced here. See
[CLI](cli.md#explicit-scope-completion-and-reopen-kyro-scope-complete--kyro-scope-reopen).

A lifecycle transition that replays cleanly reports `historical` with the detail *"live business
state is structurally replayed from the checkpoint by explicit lifecycle transitions; actor identity
unverified"*, distinguishing it from live state that never moved. It stays `historical` rather than
gaining a state of its own because the lattice measures unexplained state divergence, not actor
authentication. The detail carries the assurance boundary; the ordering does not change.

## Who maintains it

- **`kyro review`** recomputes the reviewed task's `phase.status` and the enclosing
  `activeSprint.status` on every verdict write, so status stops being an orphan field the instruction
  layer forgot to update.
- **`kyro repair`** parses leniently, sets each `phase.status` and `activeSprint.status` to its derived
  value, reconciles the project-state scope-status cache (including legacy values), then validates the
  result. Use it to migrate a scope whose status drifted.
- **`kyro analyze`** reports drift as **advisory** findings (MEDIUM): a phase or active sprint whose
  stored status contradicts its tasks, and a stale project-state scope-status cache. These never block a
  user-invoked close — status bookkeeping should not wall a destructive gate.

## Review-debt surfacing

The maker/checker gate (`docs/maker-checker.md`) is instruction-owned for marking a task `done` and
tool-owned for writing its verdict. To stop review debt from accumulating unseen until close,
`context-pack` surfaces it on every pull:

- `reviewPending`: ids of `done` tasks (phase and emergent) that lack a `pass` verdict.
- `nextTaskReview`: for a task pack, the task's status, whether it has a pass verdict, and the checker
  findings scoped to it.

## Incremental review recovery

The review gate blocks only on checker findings **scoped to the task under review**, not the global
set. This makes accumulated review debt payable one task at a time: if `T1.1`, `T1.2`, `T2.1` are all
`done` without verdicts, you can `kyro review T1.1`, then `T1.2`, and so on. `kyro analyze` keeps the
global view and `close-sprint` still blocks on it, so nothing ships un-reviewed.

## Waiving an obsoleted criterion

When an approved scope change makes an acceptance criterion unmeetable (for example, the code it
referenced was deleted), a pass verdict may waive it with a required reason:

```
kyro review T2.2 --verdict pass \
  --waive-criterion "No @Input remains::the component was deleted as emergent task TE1"
```

The waived criterion is treated as satisfied by the checker and archived with its reason in the close
narrative, so the audit trail explains why the criterion no longer applies.

MCP agents use the same waiver format through `review_task.waived_criteria`:

```json
{
  "task_id": "T2.2",
  "verdict": "pass",
  "waived_criteria": [
    "No @Input remains::the component was deleted as emergent task TE1"
  ],
  "confirm": true
}
```

The stored verdict shape remains structured: `{ "criterion": "...", "reason": "..." }`.

## Status surfaces

Kyro exposes status through both agent routers and a read-only CLI path:

- `kyro status [brief|full|debt]` reads `.agents/kyro/scopes/<scope>/sprint.json` directly and never emits trace events. The default is brief; `--json` returns stable machine fields for scope, derived status, active sprint, next action/task, blockers, open debt, and pending review count.
- `/kyro:status` (`commands/status.md`) remains the agent-facing router for read-only brief/full reports.
- `internal/skills/sprint-forge/assets/modes/STATUS.md` remains the full agent report shape.
- `context-pack` fields `reviewPending` and `nextTaskReview` remain available for agent routing; unlike `kyro status`, `context-pack` also records route-selection trace events.
- `analyze` findings report status drift and checker debt.

The CLI status command is intentionally read-only. Mutating debt intents such as `kyro status debt-add`, `kyro status debt-resolve`, and `kyro status debt-escalate` fail with `INVALID_INPUT`; debt changes belong in the workflow artifacts/gates, not the status renderer.

## Task disposition (additive contract)

`task.status` remains the progress leaf. Unfinished work that leaves a sprint is *not* another success-like status; it is an optional `task.disposition` (`deferred`, `blocked`, `superseded`, `cancelled`) written only by `kyro record-evidence`. Absence of the field is valid historical state and must not be inferred as a disposition.

Disposition does not change `derivePhaseStatus` / `deriveActiveSprintStatus` / `deriveScopeStatus` in this increment. A non-blocked disposition must not be treated as verified completion (`done` + `pass`) and must not mint `handoff.nextAction: done`. Field owners, target rules, and checkpoint compatibility are in [adr-adaptive-sprint-lifecycle.md](plans/adr-adaptive-sprint-lifecycle.md).
