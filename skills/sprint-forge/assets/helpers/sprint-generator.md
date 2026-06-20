# Sprint Generator Helper

Use only from `plan-sprint.md` after the next sprint number is known.

## Required Inputs

- Roadmap sprint summary/section for Sprint N.
- Previous sprint summary first; open previous sprint Markdown only for missing retro, recommendations, or debt detail.
- Relevant finding summaries/files for Sprint N.
- User overrides from the current request.

## Algorithm

1. Resolve Sprint N and verify Sprint N-1 is complete when N > 1.
2. Extract title, focus, type, target version, suggested phases, dependencies, and verification needs.
3. For Sprint 2+, create a disposition row for every previous recommendation: incorporated, deferred, resolved, N/A, or converted to phase. Nothing is silently dropped.
4. Build phases from roadmap suggestions, incorporated recommendations, and due debt. Each task needs an id, concise description, known files, and verification criteria.
5. Carry debt forward completely. Add new debt, mark due items `in-progress`, and never delete resolved rows.
6. Write `phases/SPRINT-{N}-{slug}.md` and `SPRINT-{N}-{slug}.summary.json`.
7. Set `state.json.activeSprint`, `currentPhase: "planning"`, `nextAction: "execute_task"`, and update `index.json` routing fields.

## Sprint File Requirements

- Disposition table exists for Sprint 2+.
- Planned phases are reviewable and independently verifiable.
- Emergent phase placeholder exists but is not pre-filled.
- Retro and recommendations remain placeholders until close.
- Definition of Done includes task completion, validation, debt update, compact evidence, retro, and re-entry update at close.

## Numbering

Sprint numbers are sequential and never reused. Emergent execution tasks use `TE.{n}` and are materialized at close.
