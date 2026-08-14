---
description: Prepare and human-authorize an auditable terminal scope retirement
argument-hint: [scope-name]
---

# /kyro:scope-retire — Human-gated router

Retirement is an exclusively human decision. This router never infers it from scope state,
`handoff.nextAction`, Forge, automation, or a previous request.

## Preparation — always first, read-only

1. Resolve the explicit scope and obtain a non-empty reason. Ask for a successor only when the
   user says another registered scope supersedes this one.
2. Run only:

   `{{KYRO_CLI}} scope retire --kyro-scope <scope> --reason "<reason>" [--superseded-by <scope>]`

3. Present the complete output: current state, reason, successor, affected files, validations and
   plan digest. Do not edit any Kyro-managed file.
4. Ask exactly: “¿Autorizas retirar el scope `<scope>` con este plan?”
5. Stop and wait. Do not run an apply command in the same interaction.

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
