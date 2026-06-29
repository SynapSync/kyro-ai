# Recover Mode

Recover when `sprint.json` is missing, unparseable, or inconsistent with the archive.

## Inputs

1. Read `.agents/kyro/kyro.json`.
2. Read the scope's `sprint.json` if it parses.
3. List `archive/sprint-*.json` (verbatim snapshots) and `archive/sprint-*.md` (narratives) as recovery evidence.

## Workflow

1. If `sprint.json` parses and is internally consistent (`handoff.nextAction` matches the state of `activeSprint`/`ledger[]`), report and route normally — no recovery needed.
2. If `sprint.json` is unparseable or truncated: rebuild it from the most recent archive snapshot (`archive/sprint-NNN-slug.json` holds the verbatim closed sprint) plus the existing `ledger[]`/`roadmap` fragments that are still readable. Reconstruct `conventions[]`, `debt[]`, `roadmap`, and `ledger[]` from the snapshots.
3. If a v3 scope is detected (`state.json`/`index.json`/`phases/` present, no valid `sprint.json`): stop and tell the user to run `kyro migrate`.
4. Write the rebuilt `sprint.json` via the Artifact Write Contract in `../../SKILL.md` (read → parse → mutate → overwrite whole file → re-parse). Set `handoff` to the correct resume point.
5. Report what was recovered and the next recommended route.

## Rules

- Prefer preserving user-authored archive narratives over making state look clean.
- Never invent completed tasks without evidence in a snapshot.
- If multiple scopes are plausible, ask the user to choose before writing.
- Do not regenerate v3 artifacts; recovery always targets `sprint.json`.
