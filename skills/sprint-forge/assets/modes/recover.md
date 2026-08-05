# Recover Mode

Recover when `sprint.json` is missing, unparseable, or inconsistent with the archive.

## Inputs

1. Read `.agents/kyro/project.json` + `.agents/kyro/local.json`.
2. Read the scope's `sprint.json` if it parses.
3. List `archive/sprint-*.checkpoint.json` first, then legacy `archive/sprint-*.json` ActiveSprint snapshots and narratives.

## Workflow

1. If `sprint.json` parses and is internally consistent (`handoff.nextAction` matches the state of `activeSprint`/`ledger[]`), report and route normally — no recovery needed. Run `{{KYRO_CLI}} analyze --kyro-scope {scope}` to locate semantic inconsistencies (clarity, coverage, broken dependencies) with severity.
2. Run `{{KYRO_CLI}} doctor --artifacts --kyro-scope {scope}`. For each checkpoint, use its classification: retry matching frozen inputs for `PREPARED` or `PARTIAL`; stop for `DIVERGED`, `CORRUPT`, or `UNSUPPORTED_VERSION`; an `APPLIED` checkpoint needs no recovery.
3. If live `sprint.json` or the affected project-state `scopes[]` entry is missing, retry `close-sprint` with the checkpoint's frozen inputs. The executor restores `intendedAfterClose` and `projectScopeAfter` under the shared state-writer lock while preserving unrelated current project fields. Invalid JSON or content matching neither protected state is `DIVERGED` and requires manual reconciliation.
4. Legacy-only `sprint-NNN-slug.json` files remain valid sprint-level evidence, but contain only `ActiveSprint`. They cannot reconstruct historical spec, debt, roadmap, handoff, ledger, conventions, criteria, clarifications, or project scope state. Report the limitation and never manufacture a checkpoint or claim full recovery.
5. Write the rebuilt `sprint.json` via the Artifact Write Contract in `../../SKILL.md` (read → parse → mutate → overwrite whole file → re-parse). Set `handoff` to the correct resume point.
6. Report what was recovered, any unrecoverable snapshot gaps, and the next recommended route.

## Rules

- Prefer preserving user-authored archive narratives over making state look clean.
- Never invent scope fields or completed tasks absent from a checkpoint or legacy snapshot.
- If multiple scopes are plausible, ask the user to choose before writing.
- Checkpoint-authorized recovery may update the scope's `sprint.json` and only its affected project-state `scopes[]` entry to the checkpoint's protected after-images. It must preserve `activeScope`, unrelated scope entries, runtime metadata, extensions, and every other project-state field verbatim.
- Legacy-only recovery remains limited to sprint-level evidence and may target only `sprint.json`; it must never infer or rewrite project scope state.
