---
description: Route Kyro session closure with minimal context loading
argument-hint: [session notes]
---

# /kyro:wrap-up — Router

Close the current Kyro session without loading the full lifecycle.

## Startup

1. Read `.agents/kyro/kyro.json`.
2. Resolve scope and read `.agents/kyro/scopes/{scope}/state.json` plus `index.json`.
3. Read `skills/sprint-forge/assets/helpers/handoff.md`.
4. Load `skills/sprint-forge/assets/modes/close-sprint.md` only when a sprint milestone or retro update is required.

## Checklist

1. Audit workspace changes with `git status`.
2. Run configured quality checks if available.
3. Capture session learnings and proposed rules.
4. Update handoff/re-entry context.
5. Refresh `state.json`, `index.json`, and changed `*.summary.json`.

## Rules

- Do not load roadmap or sprint Markdown unless summaries are missing or a closure update requires the source artifact.
- Preserve global runtime and project state paths.
- Ask before committing, deleting, or rewriting user-owned content.
