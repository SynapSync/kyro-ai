# Plan 16 — Change current work without freezing it

**Status:** Draft. No implementation claim.
**Branch:** `plan/agent-unblock` @ `36c3897` (`origin/develop`), Kyro 4.50.0.
**Keeps:** [Plan 14](plan-14-active-work-task-editing.md).
**Leaves behind:** Plan 15 (`plan --revise`, schema 5, revision journal, project-convention transactions) on `work/plan15-b1b1-certification`.

## 1. The actual problem

Kyro can create and execute a plan. It cannot cheaply **change** that plan when the user's needs move.

History protection is correct for archives, evidence and close checkpoints. It is incorrect when it also freezes **live** work. Everyday corrections become dead ends: another sprint, debt as workaround, approval chains, or hand-edits of `sprint.json`.

Changing one part must not erase previous evidence and must not stop independent ready work.

## 2. Coverage: four everyday cases

These four cases **are** the plan. Nothing else is in v1.

| # | User says | Today on this branch | Why it becomes a dead end |
| --- | --- | --- | --- |
| 1 | “Corrige este requisito y ajusta sus tareas.” | `plan --update-active` can change requirement/scenario **and** task fields in one digest, invalidate affected verdicts, keep evidence, send affected `done` tasks back to `pending`. | Cannot **remove** a requirement. Cannot cancel a task in the same request (needs a separate `record-evidence --disposition`). Scenario cannot change its requirement identity. Independent work continues only if handoff still has a ready task. |
| 2 | “Esta regla ya no aplica; reemplázala por esta.” | `rule add` only. | The old rule stays effective forever. Workaround: add a second rule (now both apply) or edit JSON. |
| 3 | “Reorganiza los próximos sprints.” | Roadmap is written at `plan` init and when a sprint is materialized. | Future entries cannot be retitled, reordered, cancelled or added. Workaround: another scope, or hand-edit. Closed sprint identities must stay put. |
| 4 | “Ya no necesito este scope.” | `close-sprint --outcome abandoned` exists. `scope retire` exists but **refuses while `activeSprint` is set**. | Agent must dispose remaining work → abandoned close → retire, surviving every gate. That is the approval chain. Retirement never closes the sprint for you. |

Supporting bug (makes 1 and 4 worse): after disposing the last unfinished task, handoff can still say `execute_task` with no ready id (`record-evidence.ts`). Disciplined agents freeze.

## 3. Invariants (every case)

1. **Live vs archive.** Open scope + current unclosed sprint is editable. Closed sprints, close checkpoints, completion/retirement records, evidence blobs and pass verdicts are not.
2. **Evidence is history, not a lock.** Previous evidence stays on the task. Affected current approval is cleared. Unrelated pass/review stays.
3. **Independent work continues.** A local correction must not blanket-block the scheduler. Never emit `execute_task` without a dependency-ready `nextTaskId`.
4. **Tool-owned writes.** No hand-edit of managed JSON. Reuse the existing writer lock and `atomicReplace`.
5. **Verify after.** Successful managed write → `kyro doctor --json` (add `--artifacts` if `sprint.json` / `project.json` changed). Doctor fail → stop.
6. **Schema 4.** No revision records, no pending-revision fence, no obligations that refuse a successful close.

## 4. Design: extend what exists, do not add a journal

Same shape as Plan 14: preview → digest → apply → doctor. One request groups the dependent edits of that case.

### Case 1 — requirement + tasks

Keep `plan --update-active` as the verb.

Add to the same input (still not a JSON-path editor):

- optional task **cancel** (records a `cancelled` disposition + reason; does not fake `done`/`pass`)
- optional requirement **remove** (refuses if a live scenario/task still points at it unless the same request relinks or cancels those consumers)

Handoff: recompute from execution state; never keep a fake `execute_task`.

Plan 14 already does the evidence/invalidation graph. Do not rebuild it.

### Case 2 — replace a local rule

```text
kyro rule remove <id> --reason "..." --kyro-scope <scope>
kyro rule replace <id> --with <new-id> --rule "..." --reason "..." --kyro-scope <scope>
```

`replace` = remove effective old + add new, one digest, history keeps the old text as inactive. **Scope-local only.** `--global` / project mirrors are out of v1; say so in help.

`rule update` (same id, new text) is allowed locally. Readers already list conventions from sprint.json; they must not keep presenting a removed id.

### Case 3 — future roadmap

Extend `plan --update-active` **or** a dedicated `plan --roadmap` only if mixing with task updates is confusing. Preference: **dedicated** `plan --roadmap` so case 1 stays about the current sprint.

Allowed on entries with `state: planned` only:

- update title
- add a future entry
- cancel a future entry (not a closed/active identity)
- reorder **presentation** of planned entries; do not renumber `n` of closed or active sprints

Materialization keeps using numeric identity. Cancelled planned entries are skipped, not resurrected.

### Case 4 — discard a live scope

Do **not** build a multi-file WAL.

Add `scope discard --dry-run` that **prepares one plan** over existing verbs:

1. cancel undisposed current tasks (disposition `cancelled`, reason = discard reason)
2. `close-sprint --outcome abandoned` (already legal for partial sprints)
3. `scope retire`

One human approval (`--digest` + `--yes` on discard) authorizes the CLI to run those stages. Interrupt → retry the same digest; each stage is the existing idempotent writer. Doctor after the last stage.

Standalone `close-sprint` and `scope retire` remain unchanged for people who still want the long path.

### Honest handoff (all cases)

`status --json` / `context-pack --json` / error envelope carry:

```json
{
  "blocker": {
    "class": "no_ready_work",
    "object": "task:T2.1",
    "why": "...",
    "remedyCommand": "kyro plan --update-active ..."
  }
}
```

Skill exception (forge/executor): if `remedyCommand` is named and the change is inside already-authorized current work, apply it, then doctor. Ask a user only for discard, project-wide policy, or ambiguous meaning.

## 5. Work slices

| Slice | Delivers | Proof |
| --- | --- | --- |
| S0 | Fixtures for the four cases **failing** on `36c3897` (plus fake `execute_task`) | Table-driven CLI tests red |
| S1 | Honest handoff + `blocker`/`remedyCommand` | No `execute_task` without ready id; JSON carries remedy |
| S2 | Case 1 extensions on `--update-active` (remove requirement, cancel task in-band) | One request corrects requirement + tasks; evidence kept; unrelated pass survives; doctor clean |
| S3 | Case 2 `rule update\|remove\|replace` local | Old rule gone from effective packs; history still lists it; doctor clean |
| S4 | Case 3 future-roadmap writer | Planned entries change; closed `n` untouched |
| S5 | Case 4 `scope discard` over existing close/retire | One approval; resume-safe; archives intact; doctor clean |
| S6 | Skill helper + doctor-after | Clean-HOME projection; no extra user turn for cases 1–3 |

S2–S5 can ship independently once S1 is in. S0 before any of them.

No CERTIFY_STAGE. `npm run check` per slice. Mutating probes use `scripts/lib/guarded-cli-probe.mjs`.

## 6. Acceptance (user-visible)

1. One `--update-active` request can change a requirement and its current tasks together. Previous evidence remains. Unrelated `pass` tasks stay runnable.
2. `rule replace process-1 --with process-2` stops presenting process-1 as effective without a new sprint or a debt workaround.
3. Future roadmap can be reordered/cancelled/extended without touching closed sprint identities.
4. `scope discard` on a live scope, after one informed approval, ends in a retired scope with abandoned close artifacts. No hand-edit.
5. Independent ready work is never told `execute_task` when nothing is ready.
6. Schema stays 4. Doctor is clean after each successful write.

## 7. Out of scope (v1)

Project-wide `--global` rule/principle mutation and legacy mirrors. Accepted-ADR link graphs. Questions resolve/withdraw. Lens. MCP. Schema 5. Revision journals. Composite discard as a new storage protocol.

## 8. Decisions to confirm

1. Case 3 as `plan --roadmap` (recommended) vs stuffing roadmap ops into `--update-active`.
2. Case 4 as staged `scope discard` over existing writers (recommended) vs documenting the three-command chain only in the skill.
3. Case 2 local-only in v1 (recommended) vs also attempting `--global` (that is how Plan 15 exploded).
