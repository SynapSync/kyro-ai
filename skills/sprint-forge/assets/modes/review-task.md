# Review Task Mode

Validate completed work and record the verdict through the Kyro checker tool.

## Inputs

1. Read `.agents/kyro/scopes/{scope}/sprint.json`.
2. Review the task identified by `handoff.nextTaskId` (the one just executed): compare its `evidence` against actual code/docs changes and its `acceptance_criteria`.
3. Read `../helpers/reviewer.md` when classifying findings.

## Workflow

1. Verify the task's `evidence` matches real changes.
2. Run the relevant checks for the touched area.
3. Classify findings as critical, warning, or suggestion. Critical issues block completion.
4. Let the tool own the verdict write:
   - Passing review: `{{KYRO_CLI}} review <task-id> --kyro-scope <scope> --verdict pass --yes`
   - Failing review: `{{KYRO_CLI}} review <task-id> --kyro-scope <scope> --verdict fail --finding critical:"<detail>" --yes`
   - Use `--by <actor-id>` when the checker actor id is known.
5. If the tool refuses a pass, treat the refusal as a blocking checker finding and route back to execution.

## Principles gate

- Before passing a task, confirm its change does not violate a `non-negotiable` principle in
  `kyro.json.principles[]`. A violation is a `fail` finding, not a suggestion.
- `{{KYRO_CLI}} review` deterministically vetoes a pass when evidence is malformed, checked criteria do
  not cover the task acceptance criteria, a non-negotiable principle gate is violated, the verdict
  predates evidence, or policy forbids self-review.

## Rules

- Do not mark a task complete without evidence and a passing verdict.
- Suggestions do not block, but must be visible in `task.verdict.findings` for the retro.
- Do not hand-edit `task.verdict`; the checker write is tool-owned.
