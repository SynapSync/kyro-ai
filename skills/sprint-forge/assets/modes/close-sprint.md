# Close Sprint Mode

Close a sprint by snapshotting it verbatim, recording a one-line ledger entry, then clearing `activeSprint`. Zero loss: the full structured record is preserved in the archive snapshot.

All `sprint.json` mutations use the Artifact Write Contract in `../../SKILL.md` (read → parse → mutate object → overwrite whole file → re-parse).

## Inputs

1. Read `.agents/kyro/scopes/{scope}/sprint.json`. The complete sprint detail is in `activeSprint` (phases → tasks with `evidence` and `verdict`).
2. Read `../helpers/debt-tracker.md` before changing `debt[]`.
3. Read `../helpers/learner.md` before extracting `conventions[]`.

## Workflow

1. Run the pre-close quality checkpoint. Confirm every task has `status: "done"` and a passing `verdict` (or is explicitly carried/blocked with reason).

### 1b. Snapshot the sprint as JSON (verbatim, zero-loss)

Before touching anything, write the entire `activeSprint` object verbatim to `archive/sprint-{NNN}-{slug}.json` (zero-padded number, e.g. `sprint-002-modal-decouple.json`). This is a fresh write-only file — never re-read by agents. It preserves 100% of the structured record (descriptions, context, acceptance_criteria, evidence, full verdicts incl. checked_criteria, timestamps, emergentTasks) regardless of how lean the narrative `.md` is.

2. Render the human narrative to `archive/sprint-{NNN}-{slug}.md` using `../templates/archive-sprint.md` (objective, definitionOfDone, phases→tasks, learnings, resolved debt, recommendations for Sprint N+1).
3. Fill the retro reasoning: went well, did not go well, surprises, new debt. Capture recommendations for Sprint N+1 (carried in the ledger entry).
4. Extract learned rules as `conventions[]` objects via `../helpers/learner.md` — each `{ id, rule, tags, addedSprint }`, e.g. `{ "id": "test-1", "rule": "...", "tags": ["testing"], "addedSprint": 2 }`. Append to `sprint.json.conventions[]`.
5. Update `debt[]` via `../helpers/debt-tracker.md`: mark resolved items `resolved`, defer with reason, add new debt objects.

### 6. Close out (one safe-write to sprint.json)

In a single in-memory mutation:

- Append a `ledger[]` entry: `{ n, slug, outcome, closedAt, archive: "archive/sprint-NNN-slug.md", snapshot: "archive/sprint-NNN-slug.json", recommendations: [...] }`.
- Set `previousSprint` to a compact summary of the sprint just closed.
- Set `activeSprint: null`.
- Update `roadmap.sprints[N-1].state` to `closed`.
- Set `handoff.nextAction`: `"plan_sprint"` if more sprints remain, else `"wrap_up"`; `handoff.nextTaskId: null`; update `handoff.note` and `handoff.lastUpdated`.

Then overwrite the whole file and re-parse to confirm validity.

### 7. Update kyro.json scope status

If this was the last sprint, set the scope's `status` to `"completed"` in `kyro.json.scopes[]` (object form `{ id, title, status }`), via the Artifact Write Contract.

## Rules

- The JSON snapshot is the complete record; the `.md` is the readable narrative; the `ledger[]` entry is the one-line index.
- Retro must be honest and specific. Recommendations must point to concrete next actions.
- Debt is never deleted; resolved debt appears in the archive and is dropped from `debt[]` only after it is recorded there.
- Never create `state.json`, `index.json`, `events.ndjson`, summaries, `RE-ENTRY-PROMPTS.md`, or `phases/`.
