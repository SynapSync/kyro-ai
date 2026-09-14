---
description: Permanently retire an obsolete, superseded, or discarded Kyro scope. Irreversible. Not for finished work.
argument-hint: [scope-name]
---

# /kyro:scope-retire — Human-gated router

Retirement is an exclusively human decision for an **obsolete, superseded, or discarded** scope.
This router never infers it from scope state, `handoff.nextAction`, Forge, automation, "cierre",
"close", "complete", "finish", or a previous request.

## Not completion

If the user asked to close, complete, finish, or mark the objective met (including "cierre del
scope" or "we're done"): do not prepare retirement. Tell them to continue in `/kyro:forge`, which
runs `scope complete`. Stop.

## Preparation — always first, read-only

1. Resolve the explicit scope and obtain a non-empty reason. Ask for a successor only when the
   user says another registered scope supersedes this one.
2. Run only:

   `{{KYRO_CLI}} scope retire --kyro-scope <scope> --reason "<reason>" [--superseded-by <scope>]`

3. If preparation succeeds, present the complete output: current state, reason, successor, affected
   files, validations and plan digest. Do not edit any Kyro-managed file.
4. Ask exactly: “¿Autorizas retirar de forma irreversible el scope `<scope>` (obsoleto, reemplazado o descartado) con este plan?”
5. Stop and wait. Do not run an apply command in the same interaction.

## Active sprint resolution — only after `SPRINT_ALREADY_ACTIVE`

Retirement itself never closes or discards an active sprint. When the read-only preparation returns
`SPRINT_ALREADY_ACTIVE`, do **not** send the user to Forge without a concrete path, do not run
`scope complete`, and do not retry retirement. The user has chosen retirement, but must separately
approve the truthful cancellation and close of unfinished work.

1. Read the active sprint detail and classify its tasks:
   - preserve tasks already `done` with a passing verdict and no disposition;
   - preserve tasks with an existing disposition;
   - list every remaining unfinished, undisposed task by id and title.
2. Present the list, the requested retirement reason, and that each listed task would be recorded as
   `cancelled`; the sprint would close as `abandoned` (never `shipped` or `completed`). Ask exactly:
   “¿Autorizas cancelar las N tareas pendientes del sprint `<n>` de `<scope>` con motivo `<reason>` para poder cerrarlo como `abandoned`?”
   Stop and wait. Ambiguous, absent, or negative approval means no write.
3. Only after that approval, record each listed task through the CLI — never hand-edit state:

   `{{KYRO_CLI}} record-evidence <task-id> --kyro-scope <scope> --summary "Scope discarded by explicit user request; task will not be implemented." --validation "Explicit user decision to discard the scope." --disposition cancelled --reason "<reason>"`

   If any command fails or the active sprint changed, stop and report it; do not invent evidence,
   overwrite an existing disposition, or continue with a stale task list.
4. Preview the truthful close:

   `{{KYRO_CLI}} close-sprint --kyro-scope <scope> --outcome abandoned --dry-run`

   Present the complete plan and ask for a separate close confirmation. Stop and wait. Only after
   approval, run the identical close command with `--yes`, supplying honest `--note`, `--summary`,
   and `--learning` values.
5. After a successful close, prepare retirement again from the new inactive state. Present its new
   digest and ask the normal retirement approval question. Stop: the old state and any prior
   retirement approval are stale, and retirement apply is always a later interaction.

## Apply — only after fresh, unequivocal human approval

After the human affirmatively approves the displayed scope and digest, run the identical command
with `--digest <reviewed-digest> --yes`. The approval is single-use and binds only that scope,
reason, successor, digest and observed state.

If apply returns `DIVERGED`, discard the old approval, prepare again, present the new complete plan,
ask the exact question again, and stop. Missing or ambiguous approval is
`HUMAN_APPROVAL_REQUIRED`; never retry by adding `--yes` yourself.

## Non-negotiable boundaries

- Never delete a scope directory or modify/delete anything under `archive/`.
- Never hand-edit `project.json`, `local.json`, `sprint.json`, checkpoints, snapshots or narratives.
- After apply, treat the scope as terminal; other tool-owned writers return `SCOPE_RETIRED`.
- Never claim the CLI proves human identity; this is an explicit procedural gate tied to state.
- Never invoke retirement from Forge, routing, handoffs, automation or heuristics.
- This router may guide explicit, separately approved task cancellation and `abandoned` close after
  `SPRINT_ALREADY_ACTIVE`; that is a prerequisite to a later retirement preparation, not retirement
  automation.
