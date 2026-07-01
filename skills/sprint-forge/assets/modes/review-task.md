# Review Task Mode

Validate completed work and record the verdict on the task object in `sprint.json`.

## Inputs

1. Read `.agents/kyro/scopes/{scope}/sprint.json`.
2. Review the task identified by `handoff.nextTaskId` (the one just executed): compare its `evidence` against actual code/docs changes and its `acceptance_criteria`.
3. Read `../helpers/reviewer.md` when classifying findings.

## Workflow

1. Verify the task's `evidence` matches real changes.
2. Run the relevant checks for the touched area.
3. Classify findings as critical, warning, or suggestion. Critical issues block completion.
4. Record the verdict on the task object via the Artifact Write Contract in `../../SKILL.md`:
   - Set `task.verdict = { result: "pass" | "fail", checked_criteria: [...], findings: [...], reviewedAt }`.
   - On `pass`: advance `handoff` (next pending task → `execute_task`, or `close_sprint` when all tasks pass).
   - On `fail`: set `task.status = "pending"`, keep `handoff.nextAction: "execute_task"`, and record the findings so the executor can fix them.

## Principles gate

- Before passing a task, confirm its change does not violate a `non-negotiable` principle in
  `kyro.json.principles[]`. A violation is a `fail` finding, not a suggestion.

## Rules

- Do not mark a task complete without evidence and a passing verdict.
- Suggestions do not block, but must be visible in `task.verdict.findings` for the retro.
- One safe-write per review; never partial-edit the JSON.
