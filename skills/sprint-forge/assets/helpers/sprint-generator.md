# Sprint Generator Helper

Use only from `plan-sprint.md` after the next sprint number is known. Produces the `activeSprint` object that gets written into `sprint.json`. Writes nothing on its own.

## Required Inputs (all from sprint.json)

- `roadmap` section for Sprint N (focus, type, target, suggested phases).
- `ledger[]` last entry: previous outcome and recommendations.
- `previousSprint` summary.
- `debt[]` items due for Sprint N.
- `conventions[]` relevant to estimation and architecture.
- User overrides from the current request.

## Algorithm

1. Resolve Sprint N and verify Sprint N-1 is closed (present in `ledger[]`) when N > 1.
2. Extract title, focus, type, target version, suggested phases, dependencies, and verification needs.
3. For Sprint 2+, create a disposition for every previous recommendation: incorporated, deferred, resolved, N/A, or converted to phase. Nothing is silently dropped.
4. Build `phases[]` from roadmap suggestions, incorporated recommendations, and due debt. Each task needs `id`, `title`, `description`, `files_to_touch`, `context` (fold in relevant `conventions[]`), `acceptance_criteria`, `depends_on`, `status: "pending"`, `evidence: null`, `verdict: null`.
5. Carry debt forward completely in `debt[]`: add new debt objects, mark due items `in_progress`, never delete resolved rows.

## activeSprint shape produced

```json
{
  "n": 2, "slug": "validation-hardening", "objective": "...", "status": "executing",
  "phases": [ { "id": "P1", "title": "...", "objective": "...", "status": "pending", "tasks": [ /* task objects */ ] } ],
  "emergentTasks": [],
  "definitionOfDone": ["All tasks done with evidence", "All tasks pass verdict", "Quality gates pass"]
}
```

## Requirements

- Planned phases are reviewable and independently verifiable.
- `emergentTasks` starts empty; it is filled during execution only.
- Sprint numbers are sequential and never reused. Emergent tasks use `TE.{n}`.
- The generator hands this object back to `plan-sprint.md`, which performs the single safe-write to `sprint.json`. No `phases/` files, no `state.json`, no `index.json`.
