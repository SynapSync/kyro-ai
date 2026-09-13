# QA or Close Mode

The active sprint has completed task-level maker/checker review. Ask the user whether to run the independent Kyro QA certification or close the sprint without it. Both choices are valid.

`kyro qa` below names the installed Kyro command/skill. It is **not** a shell subcommand of `{{KYRO_CLI}}`; invoke it through the host's command/skill resolution exactly as `kyro qa <scope>`.

## Inputs

1. Read `.agents/kyro/scopes/{scope}/sprint.json` only after routing here. Confirm every phase and emergent task is `done` with a passing task verdict and no disposition.
2. Run `{{KYRO_CLI}} analyze --kyro-scope {scope}`. Do not offer close while CRITICAL or HIGH findings remain.
3. Keep the current-session flag `qaRemediationPending` in orchestration context only. It is deliberately not persisted in Kyro state.

## Initial decision

When `qaRemediationPending` is false or absent, ask the user to choose exactly one:

1. **Run QA** — invoke `kyro qa <scope>` through the host and follow **QA result handling** below.
2. **Close without QA** — load `close-sprint.md` and follow its existing user gate. Do not record QA as skipped.

Do not imply that QA is mandatory before the initial close. Do not pass `qa` to the resolved CLI binary; it is a host command/skill, not a shell verb.

## QA result handling

Interpret the existing QA contract without writing the QA report into `sprint.json`:

- `APPROVED` → load `close-sprint.md` and continue through its user gate.
- `APPROVED WITH NOTES` → non-blocking. Register actionable notes as debt only when appropriate, then load `close-sprint.md`.
- `CHANGES REQUIRED` or `REJECTED` → closing is blocked. Set `qaRemediationPending = true` in current-session orchestration context and materialize every blocking correction through the existing CLI-owned task lifecycle.

If the report is missing a clear verdict or does not provide enough detail to write verifiable acceptance criteria, stop and ask for clarification. Never guess and never close.

## Materialize blocking corrections

For each coherent correction unit:

- Finding clearly violates an existing task's acceptance criteria → run `{{KYRO_CLI}} review <task-id> --kyro-scope <scope> --verdict fail --finding critical:"..." --yes` so that task returns to execution.
- New, cross-cutting, or ambiguously owned work → run `{{KYRO_CLI}} add-emergent --kyro-scope <scope> --title "..." --description "..." --acceptance "..." [--file <path> ...] --context "Required by kyro qa: ..."`.
- Non-blocking follow-up → use `{{KYRO_CLI}} debt add`; do not disguise it as completed work.

Group findings only when they share one implementation and validation boundary. Every emergent task needs independently verifiable acceptance criteria.

After materialization, obey the new `context-pack` route and execute/review corrections normally. `add-emergent` owns the handoff back to `execute_task`.

## Mandatory re-QA in the current session

When all corrective tasks pass and routing returns to `qa_or_close` while `qaRemediationPending` is true:

1. Do **not** offer close without QA again.
2. Invoke `kyro qa <scope>` immediately.
3. Repeat remediation and re-QA until the result is `APPROVED` or `APPROVED WITH NOTES`, or until blocked on a user decision.
4. Clear the in-memory flag only after an approving result, then continue to `close-sprint.md`.

If the session ends, the flag is lost by design. A fresh session presents the initial QA-or-close decision again; do not claim that QA history is persisted.

## Rules

- QA remains optional before the first close decision.
- Once QA fails in this session, re-QA is mandatory before close.
- `kyro qa` remains read-only and outside task verdict storage.
- All task, evidence, verdict, debt, and close writes remain owned by existing `{{KYRO_CLI}}` verbs.
- Never hand-edit `sprint.json` or create a QA state field.
