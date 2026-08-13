# Clarify Mode

Resolve ambiguity **before** generating tasks. A weak model that guesses produces wrong plans and
lost work; this mode forces the unknowns to the surface and records accepted answers through the
tool-owned `{{KYRO_CLI}} clarify` command. Agents never edit `sprint.json` directly.

Routed when `handoff.nextAction == "clarify"`, or pulled from `INIT`/`plan-sprint` when the scope
carries `[NEEDS CLARIFICATION]` markers or high ambiguity.

## Inputs

1. Read `.agents/kyro/scopes/{scope}/sprint.json`.
2. Note every `[NEEDS CLARIFICATION: ...]` marker already present in `objective`, `successCriteria`,
   `spec.openQuestions`, `roadmap`, or task fields — each is an explicit unknown to resolve.

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

## Explain the route before questioning

At entry, tell the user in plain language that `clarify` means Kyro has design decisions that must
be settled before it can safely plan or execute. State how many open questions/markers remain and
what happens next: one contextual question at a time; accepted answers are recorded by the CLI;
when none remain, Kyro routes to planning or execution.

## Questioning loop

- Ask only if the answer materially impacts architecture, data model, task decomposition, test design,
  UX, or compliance. If nothing qualifies, skip straight to routing. There is no arbitrary question
  cap: stop once material ambiguity is resolved.
- **One question at a time. Stop and wait for the answer before the next.** A later question may be
  reframed by the user's answer or follow-up questions.
- Before asking, explain why the decision matters, the known constraints, each option's trade-off,
  and the recommended option only when supported by evidence. Invite the user to ask for more context
  or propose another option; do not treat multiple choice as a forced answer.
- Prefer multiple-choice: 2–5 mutually exclusive options, **recommended option first**. Otherwise ask
  for a short answer, explicitly constrained: "answer in ≤5 words".
- After each accepted answer, create a lean resolution JSON outside Kyro state and call
  `{{KYRO_CLI}} clarify --from <file> --kyro-scope <scope>`. Include the exact target, accepted
  answer, and any verifiable requirement derived from it. The CLI appends `{ q, a, sprint, date }`,
  updates `spec`, removes the resolved question/marker, validates the full artifact, and routes safely.
- If the user explicitly asks to defer registration, keep the answers in conversation only and apply
  one CLI batch after the user confirms the accumulated decisions. Never use an editor, patch, or
  fallback safe-write for either the single-answer or batch path.
- If `clarify` is absent from `{{KYRO_CLI}} capabilities --json`, stop and ask for a Kyro runtime
  update. A missing verb is never authorization to modify `sprint.json` manually.

## Routing out

`{{KYRO_CLI}} clarify` sets `handoff.nextAction`:
- `plan_sprint` if tasks are not generated yet (the normal path from INIT/plan).
- `execute_task` if tasks already exist and only ambiguity blocked them.
- `clarify` while any open question or marker remains.

## Rules

- Never invent an answer to dodge a question — that is exactly the failure this mode prevents.
- `{{KYRO_CLI}} doctor --artifacts` (and `{{KYRO_CLI}} analyze`) **fail** while any `[NEEDS CLARIFICATION]` marker
  remains. Do not route to `plan_sprint`/`execute_task` with markers still in the file.
- `spec.openQuestions[]` are visible analyze warnings. Drain them as the answers become stable
  requirements; do not leave resolved questions in the queue.
- The CLI is the only writer. No hand edits, including whole-file safe-writes or partial JSON edits.
