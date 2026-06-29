---
description: Route Kyro session closure with minimal context loading
argument-hint: [session notes]
---

# /kyro:wrap-up — Router

Close the current Kyro session without loading the full lifecycle.

## Startup

1. Read `.agents/kyro/kyro.json`.
2. Resolve scope and read the scope's `sprint.json`.
3. Load `skills/sprint-forge/assets/modes/close-sprint.md` only when a sprint milestone or retro actually closed this session.

## Checklist

1. Audit workspace changes with `git status`.
2. Run configured quality checks if available.
3. Capture session learnings as `conventions[]` objects (see `helpers/learner.md`) only if a real correction or pattern emerged.
4. Update `sprint.json.handoff`: set `nextAction`, `nextTaskId`, `blockers`, and a concise `note` describing where to resume.

All updates to `sprint.json` use the Artifact Write Contract in `skills/sprint-forge/SKILL.md` (read → parse → mutate → overwrite whole file → re-parse).

## Rules

- The resume context lives in `sprint.json.handoff.note`; there is no separate re-entry file.
- Preserve global runtime and project state paths.
- Ask before committing, deleting, or rewriting user-owned content.
