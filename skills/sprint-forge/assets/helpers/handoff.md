# Sprint Handoff — Resume Context

## Purpose

Captures the mental context a fresh session needs to resume — hypotheses, decisions, blockers, and the single most important next action. In v4 this lives in `sprint.json.handoff`, not a separate file.

## Where it lives

`sprint.json.handoff`:

```json
{
  "nextAction": "execute_task",
  "nextTaskId": "T2.3",
  "blockers": ["Staging env not provisioned (infra team, ETA unknown)"],
  "note": "Implementing rate-limit middleware in src/middleware/rate-limit.ts (half done). Suspected N+1 at userService.ts:47. Decision pending: Redis vs in-memory cache.",
  "lastUpdated": "2026-06-29"
}
```

- `nextAction`: the route (`init | plan_sprint | execute_task | review_task | close_sprint | wrap_up`).
- `nextTaskId`: the task to resume, or `null`.
- `blockers`: concrete things preventing progress.
- `note`: free-text mental context — active hypotheses, pending decisions, where work was left. This is the resume prompt; keep it specific and current.

## Update points

- Each task transition: refresh `nextTaskId`, `nextAction`, and `note`.
- Wrap-up: set `note` to the most important thing to do next session, list `blockers`.
- Sprint close: point `note` at the next sprint or scope completion.

## Generation

1. Read current `sprint.json` for task state.
2. Review the session for hypotheses, decisions, and blockers.
3. Check `git status` for uncommitted work.
4. Write `handoff` via the Artifact Write Contract in `../../SKILL.md`.

There is no `handoffs/` directory and no `RE-ENTRY-PROMPTS.md` — the resume context is a field on the single source of truth.
