# ADR — Adaptive sprint lifecycle contract

**Status:** Accepted for implementation in scope `adaptive-sprint-lifecycle` (Sprint 1). Not a release authorization.

**Context:** Kyro treats an incomplete task and an exhausted initial roadmap as terminal failure. Traceability (checkpoints, ledger, Integrity) is valuable; using it as a veto on legitimate reprioritization is not. This record names every lifecycle field this scope may change, its single writer, its readers, and the compatibility policy. Schema and writer changes land in T1.2; close/routing/Integrity changes land in later tasks.

## Decision

1. **Dispositions are a separate record, not extra success statuses.** `task.status` remains progress (`pending | in_progress | done | blocked`). `task.verdict` remains checker-owned (`pass | fail`). Unfinished work that leaves the sprint is explained by optional `task.disposition`.
2. **One writer: extend `kyro record-evidence`.** No new CLI root. `done`/`blocked` without a disposition keep today's meaning (evidence + route to `review_task`). A disposition is a different transition on the same verb.
3. **Close does not complete a scope.** `deriveSprintCloseTransition` must not set `handoff.nextAction: done` or scope `completed` merely because the original roadmap is exhausted. That change is T1.4; this ADR forbids implementing it any other way.
4. **Retirement stays the only existing terminal path.** Human-gated, `nextAction: done`, immutable. Scope completion, if added later, is a different operation.
5. **Historical bytes are not rewritten.** Absent `disposition` means "this record predates the field or the task was not disposed." Readers must not infer dispositions retroactively.

## Lifecycle field owners

Only `task.status` is the progress leaf today (`docs/status-coherence.md`). Disposition does not replace it.

| Field | Single writer | Readers | This scope |
| --- | --- | --- | --- |
| `task.status` | `record-evidence` (`done`/`blocked`); `review` (fail → `pending`); `plan` / `add-emergent` (`pending`) | `core/status.ts`, `analyze`, `review` (`allDonePass`), `context-pack`, `status`, close narrative, repair | Unchanged vocabulary. Disposition must never write `done`. |
| `task.evidence` | `record-evidence` only | `analyze` / `review` checker, close narrative | Still required on the verb, including when recording a disposition (audit of what was tried or decided). |
| `task.verdict` | `review` only | `analyze`, `review` routing, close, `context-pack` | Disposition is not a verdict and must not write `pass`. A `pass` task cannot be disposed. |
| `task.disposition` | **`record-evidence` only** (new) | schema, later close/status/context-pack (T1.3–T1.5) | Optional object. Kinds: `deferred`, `blocked`, `superseded`, `cancelled`. |
| `phase.status` / `activeSprint.status` | Derived at `record-evidence` and `review`; normalized by `repair` | `analyze` (advisory drift), `status` | No new vocabulary in Sprint 1. Blocked *progress* still derives `blocked`; a non-blocked disposition must not force scope `blocked`. |
| `handoff.nextAction` | `plan`, `clarify`, `record-evidence` (`review_task`), `review` (`execute_task`/`close_sprint`), `deriveSprintCloseTransition` (`plan_sprint`/`done`), `scope retire` (`done`) | forge router, `plan` gate, `context-pack`, `status`, orchestrator | Disposition write must **not** route to `review_task`. Close must **not** auto-`done` (T1.4). |
| `handoff.nextTaskId` | Same writers as `nextAction` | `context-pack`, `status` | After a disposition, next pending/in_progress task without a disposition, else `null`. |
| `sprint.json` `status` / `KyroScopeEntry.status` | `deriveScopeStatus` (close, plan, repair, reconcile, `core/scopes`, `status`, `analyze`) | project registry, doctor, status | Today: no active sprint + all roadmap `closed` → `completed`. T1.4 stops inferring completion from roadmap length. |
| `roadmap.sprints[].state` | `plan` (`active`); `deriveSprintCloseTransition` (`closed`) | `deriveScopeStatus`, `plan` | Unchanged: a closed slot is history, not scope completion. |
| `ledger[]` / close checkpoint / snapshot / narrative | `close-sprint` only | doctor, Integrity, retire, remediations, recertify, status | Immutable. T1.3 includes dispositions in dry-run, checkpoint, ledger-adjacent narrative. Never rewrite v1 bytes. |
| `debt[]` | `kyro debt` | analyze, status, Integrity (not replayed as a remediation op) | Deferred disposition **targets** an existing debt id (`debt-N`) or a future sprint number. Writer does not create debt. |
| `retirement` | `scope retire` apply | schema (`nextAction` must be `done`), `deriveScopeStatus`, doctor | Out of band. Distinct from delivery. |

### Instruction-layer readers (not writers)

These consume `nextAction` / task status and currently teach “scope complete / stop” when `done`:

- `agents/orchestrator.md`
- `internal/skills/sprint-forge/assets/modes/execute-task.md`
- `internal/skills/sprint-forge/assets/modes/close-sprint.md`
- forge router (`commands/forge.md`)

T1.5 updates close guidance. Adapters do not grow a new root verb; they keep invoking `record-evidence`.

### Integrity / Doctor

| Mechanism | What it protects | This scope |
| --- | --- | --- |
| Checkpoint identity, digests, path safety | Immutable close archives | Fail-closed, unchanged |
| `planLiveEvolution` | Post-close `convention.append`, `adr.append`, `ledger.checkpoint.reanchor` | Does **not** know `debt add` or dispositions. Do not add `debt.add` or `disposition.append` to v5 remediation in this scope. Lawful live evolution vs archive drift is T1.6 / Sprint 3. |
| `repair` status normalize | Derived phase/sprint/scope status | Must keep treating unknown future fields as absent until T1.5 |

## Selected disposition representation

```text
task.disposition?: {
  kind: "deferred" | "blocked" | "superseded" | "cancelled"
  reason: string          // non-empty
  by: string
  recordedAt: string      // ISO-8601, stamped by the writer
  target?: { kind: "debt" | "task" | "sprint", id: string }
}
```

| Kind | Meaning | Target |
| --- | --- | --- |
| `deferred` | Work moved out of this sprint | **Required:** `debt:<id>` (id exists in `debt[]`) or `sprint:<n>` (`n` integer ≥ 1, may be a future sprint not yet on the roadmap) |
| `superseded` | Replaced by other work | **Required:** `task:<id>` (id exists in this sprint, not self) |
| `blocked` | Closed while still blocked | Optional valid target |
| `cancelled` | Intentionally not done | Optional valid target |

Invariants:

- Presence of `disposition` means the task is **not** verified complete. Writer rejects `--status done`, existing `status: done`, or a `pass` verdict.
- `blocked` as **status** (in-sprint, still reviewable) stays `--status blocked` without `--disposition`.
- `blocked` as **disposition** is a terminal explanation at the same verb; it does not route to `review_task`.
- Unknown kind, blank reason, malformed `--target`, missing required target, unknown debt/task id, or self-supersession fail with no write.
- Omit the key when there is no disposition. `null` is invalid (one representation).

CLI (same root):

```bash
kyro record-evidence <task> --disposition <kind> --reason "<why>" [--target debt:<id>|task:<id>|sprint:<n>] \
  --summary "..." --validation "..."
```

Why not `kyro task`: the public surface is already broad; `record-evidence` already owns the maker write onto a located task. A new root would duplicate location, locking, validation, and adapter recipes.

Why not more `TaskStatus` values: `done` would stop meaning “evidence-backed completion,” and `derivePhaseStatus` / checker findings are all `done`-gated. Mixing terminal explanations into progress would force every reader to change at once.

## Compatibility and migration

| Record | Read policy | Write policy |
| --- | --- | --- |
| Live `sprint.json` without `disposition` | Valid. Same as today. | Writers omit the key until a disposition is recorded. |
| Live `sprint.json` with valid `disposition` | Valid after T1.2 schema. | Only `record-evidence`. |
| Sprint-close checkpoint v1 / legacy snapshot | Validate as today. Historical `beforeClose` tasks without `disposition` remain valid. Do not backfill. | Never rewrite checkpoint bytes. New closes (T1.3) may *contain* dispositions inside `beforeClose` because that object is the live sprint at close time. |
| Retired scopes | `retirement` + `nextAction: done` unchanged. | `SCOPE_RETIRED` still blocks mutators. |
| `handoff.nextAction: done` already stored | Historical completed/retired scopes stay `done`. | New closes must not mint `done` from roadmap exhaustion (T1.4). Existing `done` scopes are not auto-reopened. |

`schemaVersion` stays 4. The field is additive.

## What later tasks own (do not implement here)

- **T1.3** — `close-sprint` requires a disposition on every unfinished task; derives a truthful outcome; surfaces dispositions in dry-run/checkpoint/narrative. Still does not auto-complete the scope.
- **T1.4** — `deriveSprintCloseTransition` + `deriveScopeStatus` + `plan` keep an open scope routable to `plan_sprint` after any close, including the last original roadmap slot.
- **T1.5** — `status` / `context-pack` / close-mode copy distinguish verified completion from disposed work.
- **T1.6** — regressions that falsify auto-`done` and missing dispositions without a new harness.

## Consequences

- Agents gain a lawful, tool-owned way to defer, replace, cancel, or close-as-blocked without pretending success.
- Integrity remains fail-closed for archives; this ADR does not widen remediation kinds.
- `--status blocked` without `--disposition` remains the three-failed-rounds path and still goes to review.
- Consumers (NutriLens / Kyro Lens) see an additive optional field; absence is the historical record.
