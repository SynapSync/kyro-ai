# Backlog: Agent Harness, Hooks, and Commands

Kyro should not ask agents to perform deterministic checks from memory. It should provide small commands and hooks that agents can call at phase boundaries.

## Evidence

- `doctor`, `repair`, `scope`, `sync`, `detect`, and adapter projections already exist.
- Command routers define read order and route selection.
- Orchestrator docs describe checkpoints, but several checkpoint behaviors remain prompt-level rather than CLI-level.

## Technical correction

Create deterministic commands for the recurring harness tasks: validate artifacts, refresh summaries, package context, detect docs impact, and log events.

## Tasks

| ID | Priority | Size | Task | Likely files | Acceptance criteria | Validation |
|----|----------|------|------|--------------|---------------------|------------|
| AHH-001 | P1 | M | Implement `kyro artifact validate` | `src/cli/app.ts`, `src/cli/commands/artifact-validate.ts` | Validates project, scope, summaries, and source freshness via schemas | Fixture tests |
| AHH-002 | P1 | M | Implement `kyro refresh-summaries` | `src/cli/commands/refresh-summaries.ts`, repair helpers | Refreshes derived JSON without implying recovery/repair | Artifact fixture before/after |
| AHH-003 | P1 | M | Implement `kyro context-pack` | see token backlog | Emits minimal task/status/init context | Context-pack fixtures |
| AHH-004 | P1 | M | Implement `kyro docs impact` | docs index command/script | Reports docs affected by changed source or command files | Golden fixture |
| AHH-005 | P2 | M | Implement `kyro event append` internal helper | `src/cli/events/*` | CLI can append normalized events for phase/check/result | Unit tests |
| AHH-006 | P2 | M | Add phase hook conventions | `docs/harness-hooks.md`, `commands/*.md` | Defines before_task, after_task, before_commit, after_merge command sequence | Link check |
| AHH-007 | P2 | S | Add adapter projection smoke checks to doctor | `src/cli/commands/doctor.ts`, adapters | Doctor reports command skill projection freshness and adapter health consistently | `kyro doctor --adapters` |

## Hook table

| Hook | Trigger | Deterministic command |
|------|---------|-----------------------|
| before_task | Task selection | `kyro context-pack --task <id>` |
| after_task | Markdown/code changed | `kyro refresh-summaries && kyro artifact validate` |
| before_commit | Commit preparation | `npm run check:dist && npm run check:adapters && npm run check` |
| after_merge | Main branch update | `kyro refresh-summaries && kyro docs index` |
| status | User asks progress | `kyro scope inspect` plus summaries/context pack |
