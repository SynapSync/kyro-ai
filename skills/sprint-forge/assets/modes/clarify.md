# Clarify Mode

Resolve ambiguity **before** generating tasks. A weak model that guesses produces wrong plans and
lost work; this mode forces the unknowns to the surface and records the answers. It writes only
`sprint.json` (safe-write), never new files.

Routed when `handoff.nextAction == "clarify"`, or pulled from `INIT`/`plan-sprint` when the scope
carries `[NEEDS CLARIFICATION]` markers or high ambiguity.

## Inputs

1. Read `.agents/kyro/scopes/{scope}/sprint.json`.
2. Note every `[NEEDS CLARIFICATION: ...]` marker already present in `objective`, `successCriteria`,
   `roadmap`, or task fields — each is an explicit unknown to resolve.

## Ambiguity scan (mark Clear / Partial / Missing)

Scan these categories; only the weak ones become questions:

1. Functional scope & behavior
2. Domain & data model
3. Interaction & UX flow
4. Non-functional quality (performance, security, a11y)
5. Integration & external dependencies
6. Edge cases & failure handling
7. Constraints & tradeoffs
8. Terminology & consistency
9. Completion signals (what "done" means)

## Questioning loop (hard limits)

- **Maximum 5 questions total.** Ask only if the answer materially impacts architecture, data model,
  task decomposition, test design, UX, or compliance. If nothing qualifies, skip straight to routing.
- **One question at a time. Stop and wait for the answer before the next.**
- Prefer multiple-choice: 2–5 mutually exclusive options, **recommended option first**. Otherwise ask
  for a short answer, explicitly constrained: "answer in ≤5 words".
- After each accepted answer, **safe-write immediately** (read → parse → mutate → overwrite → re-parse):
  - Append `{ q, a, sprint, date }` to `clarifications[]`.
  - Apply the answer to the right place: functional → `objective`/task fields; data shape → task
    `context`; non-functional → `successCriteria[]`; edge case → task `acceptance_criteria`;
    terminology → normalize across the file.
  - **Remove the corresponding `[NEEDS CLARIFICATION]` marker** once resolved.
- Stop when all critical ambiguities are resolved, the user signals done, or 5 questions are asked.

## Routing out

Set `handoff.nextAction` via safe-write:
- `plan_sprint` if tasks are not generated yet (the normal path from INIT/plan).
- `execute_task` if tasks already exist and only ambiguity blocked them.
- `lastUpdated` to today.

## Rules

- Never invent an answer to dodge a question — that is exactly the failure this mode prevents.
- `kyro doctor --artifacts` (and `kyro analyze`) **fail** while any `[NEEDS CLARIFICATION]` marker
  remains. Do not route to `plan_sprint`/`execute_task` with markers still in the file.
- One safe-write per accepted answer; never partial-edit the JSON. No new files.
