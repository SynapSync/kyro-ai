# Plan Sprint Mode

Generate the next sprint from structured state first, then Markdown evidence only as needed.

## Inputs

1. Read `.agents/kyro/scopes/{scope}/state.json`.
2. Read `.agents/kyro/scopes/{scope}/index.json`.
3. Read `ROADMAP.summary.json` if present; otherwise open `ROADMAP.md`.
4. For Sprint 2+, read previous `SPRINT-*.summary.json` first; open Markdown only for missing retro, recommendation, or debt detail.
5. Read `../helpers/sprint-generator.md` only after the next sprint number is known.
6. Load `../templates/SPRINT.md` only when writing the sprint file.

## Workflow

1. Resolve next sprint number from state/index and existing `phases/` files.
2. Extract roadmap focus, type, target version, and suggested phases.
3. Build the mandatory disposition table for every previous recommendation.
4. Assemble phases from roadmap suggestions, carried recommendations, and due debt.
5. Write `phases/SPRINT-{N}-{slug}.md`.
6. Write `phases/SPRINT-{N}-{slug}.summary.json`.
7. Update `state.json` with `activeSprint`, `currentPhase: "planning"`, and `nextAction: "execute_task"`.
8. Update `index.json` with active sprint summary, next task, open debt count, and relevant paths.

## Rules

- Never generate Sprint N+1 before Sprint N is complete.
- Every previous recommendation must be incorporated, deferred, resolved, marked N/A, or converted to a phase.
- Debt is inherited completely; never reset or drop debt rows.
