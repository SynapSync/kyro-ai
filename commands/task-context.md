---
description: Generate a copy-paste prompt for resuming Kyro work in a fresh context
argument-hint: [scope or task notes]
---

# /kyro:task-context — Router

Generate a ready-to-paste prompt for a new agent context. This command is read-only: it does not update `sprint.json`, close tasks, create commits, or rewrite handoff state.

## Startup

1. Read `.agents/kyro/project.json` + `.agents/kyro/local.json`.
2. Resolve the active scope unless the user supplied a scope.
3. Run or reconstruct `kyro context-pack --kyro-scope <scope> --task --verbosity detailed --json`. If there is no active task, use scope mode.
4. Check `git status --short --branch`.
5. Read only the referenced task/sprint artifacts needed to avoid inventing state.

## Prompt Requirements

Return one fenced Markdown block containing the next-context prompt. The prompt must include:

- Current branch and workspace status.
- Exact scope, `sprint.json` path, `handoff.nextAction`, and `handoff.nextTaskId`.
- Files/artifacts the next agent must read first.
- The immediate next action and explicit non-goals.
- Relevant task description, files, acceptance criteria, scenarios, blockers, conventions, and review debt.
- Required verification commands from project docs or task context.
- Rules: verify live repo state first, never trust stale summaries, do not read secrets, use Conventional Commits, and never add AI attribution.
- Return format: status, executive summary, files changed, verification, next recommendation, risks.

## Quality Bar

- Be concrete enough that a fresh agent can start without asking the user to restate context.
- If required state is missing or contradictory, output a blocked prompt that tells the next agent what to verify first.
- Prefer paths and commands over prose.
- Do not claim work is complete without evidence in `sprint.json`, git status, or verification output.
