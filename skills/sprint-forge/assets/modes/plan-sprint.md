# Plan Sprint Mode

Generate the next sprint as the `activeSprint` object inside `sprint.json`. This is the file that historically produced v3 drift — it writes ONLY `sprint.json`, never `phases/`, `state.json`, `index.json`, or summaries.

## Inputs

1. Read `.agents/kyro/scopes/{scope}/sprint.json` (single source of truth).
2. From it, use `roadmap` (next sprint focus), `ledger[]` (previous outcomes + recommendations), `previousSprint`, `debt[]` (carry-forward), and `conventions[]` (apply learned rules to estimates and task context).
3. Read `../helpers/sprint-generator.md` only after the next sprint number is known.

## Workflow

1. Resolve the next sprint number `N` from `roadmap.sprints` and `ledger[]` (highest closed + 1). Verify Sprint N-1 is closed when N > 1.
2. Extract roadmap focus, type, target version, and suggested phases for Sprint N.
3. For Sprint 2+, account for every previous recommendation from the last `ledger[]` entry: incorporate, defer, resolve, mark N/A, or convert to a phase. Nothing is silently dropped.
4. Assemble `phases[]` from roadmap suggestions, carried recommendations, and due `debt[]` items. Each task needs `id`, `title`, `description`, `files_to_touch`, `context`, `acceptance_criteria`, `depends_on`, `status: "pending"`, `evidence: null`, `verdict: null`.
5. Fold relevant `conventions[]` into each task's `context`.

## Write (safe-write to sprint.json only)

Using the Artifact Write Contract in `../../SKILL.md` (read → parse → mutate object → overwrite whole file → re-parse):

- Set `activeSprint` to the new sprint object: `{ n, slug, objective, status: "executing", phases, emergentTasks: [], definitionOfDone }`.
- Mark due `debt[]` items `in_progress` (do not delete or reset any debt).
- Update `roadmap.sprints[N-1].state` to `active`.
- Set `handoff.nextAction: "execute_task"`, `handoff.nextTaskId` to the first task id, `handoff.lastUpdated` to today.

## Rules

- Never generate Sprint N+1 before Sprint N is closed (in `ledger[]`).
- Every previous recommendation must be incorporated, deferred, resolved, marked N/A, or converted to a phase.
- Debt is inherited completely; never reset or drop debt items.
- Write nothing but `sprint.json`. No `phases/`, no `*.summary.json`, no `state.json`, no `index.json`.
