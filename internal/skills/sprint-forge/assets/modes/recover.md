# Recover Mode

Recover when `sprint.json` is missing/unparseable, or when `repair integrity prepare` reports findings.

## Inputs

1. Read `.agents/kyro/project.json` + `.agents/kyro/local.json`.
2. Run `{{KYRO_CLI}} repair integrity prepare --json`.
3. If `sprint.json` is missing, also inspect close checkpoints for a resume path.

## Workflow

1. If prepare reports no findings and `sprint.json` is consistent, route normally. Do not ask the user anything.
2. If prepare reports `blockers` (unsupported, diverged, irreconcilable, identity-conflict, unrecoverable), show every blocker and stop. Do not apply. Restore or isolate the incompatible evidence first.
3. If prepare reports findings without blockers, show the human target list from the JSON (`targets`), including every convention, ADR, and ledger reanchor, not internal operation kinds. Ask exactly: “¿Autorizas la reparación?” Stop. Do not apply in the same unanswered turn.
4. After an explicit yes for that digest, run only:

   `{{KYRO_CLI}} repair integrity apply --digest <digest> --yes`

   Then `{{KYRO_CLI}} doctor --artifacts`. If doctor exits 0, report PASS and continue routing. If apply returns `DIVERGED`, prepare again, show the new targets, and ask again. Retrying the same approved digest after a crash is required; do not treat a completed prefix as a new plan.
5. If `sprint.json` is missing and a close checkpoint can resume, retry `{{KYRO_CLI}} close-sprint` with that checkpoint's frozen inputs. Do not invent state.
6. Never hand-edit `sprint.json`, `project.json`, `local.json`, checkpoints, snapshots, or narratives.

## Rules

- One approval binds the exact listed targets and the prepare digest.
- Never add `--yes` without a fresh human answer to the current digest.
- Prefer preserving archive bytes over making state look clean.
- If multiple scopes are plausible for a missing-sprint resume, ask the user to choose before writing.
