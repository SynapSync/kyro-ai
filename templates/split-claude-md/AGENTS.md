# AGENTS.md — Kyro Workflow Rules

## Sprint Discipline

### One Sprint at a Time

- Never start a new sprint while one is in progress.
- Each sprint must reach a terminal state (completed, abandoned, or blocked) before the next begins.
- If the current sprint is blocked, document the blocker and pause — do not silently start new work.

### Retrospective Required

- Every completed sprint MUST end with a retrospective (the retrospective phase of forge).
- The retro captures: what worked, what did not, estimation accuracy, and concrete improvements.
- Learnings from the retro are written to `LEARNED.md` and to `.agents/sprint-forge/rules.md` for per-project reuse.
- Skipping the retro is a workflow violation.

### Debt is Inherited

- Technical debt items from previous sprints carry forward automatically.
- Debt items are never silently dropped. They can only be:
  - **Resolved** — fixed and verified in a sprint task.
  - **Deferred** — explicitly moved to a future sprint with justification.
  - **Accepted** — acknowledged as permanent with documented rationale.
- Debt aged beyond 3 sprints is flagged as critical.

## Quality Gates

Every sprint phase transition requires a quality gate:

1. **Analysis gate** — Analysis phase findings reviewed and approved before planning.
2. **Plan gate** — Sprint plan reviewed and approved before implementation.
3. **Implementation gate** — Each task passes lint, type-check, and tests before marking complete.
4. **Review gate** — Review step validates task output against acceptance criteria.
5. **Commit gate** — All quality checks pass before final commit.

Rules:
- Never skip a gate. If a gate fails, fix the issue before proceeding.
- Gate approvals require explicit user confirmation.
- If tests or lint are not configured, note it as a warning but do not block.

## Re-entry Prompt

When a session ends or context is compacted:

1. Save the current sprint state as a checkpoint.
2. Write a re-entry prompt to `.agents/sprint-forge/{project}/reentry.md` that contains:
   - Current sprint ID and phase.
   - Last completed task.
   - Next task and its context.
   - Any blockers or open questions.
3. On session start, load the re-entry prompt to restore context.

## Orchestrator Protocols

### Analysis Protocol

Use for: initial codebase analysis, architecture mapping, risk identification.

- Read-only during this phase. Must not modify any files.
- Runs automatically during the Analyze phase of `/kyro-workflow:forge`.
- Can be invoked manually for ad-hoc exploration.

### Review Checklist

Use for: task validation, quality checklist enforcement.

- Runs after each task completion.
- Checks: correctness, test coverage, lint compliance, acceptance criteria.
- Classifies findings as BLOCKER, WARNING, or SUGGESTION.
- BLOCKERs must be resolved before task is marked done.

### Debug Protocol

Use for: root cause analysis when a task fails or tests break.

- Invoked automatically on repeated failures.
- Must produce a root cause report before suggesting a fix.
- Fixes are proposed, not applied — user approves before changes.

### Full Cycle Coordination

The orchestrator manages the Analyze -> Plan -> Implement -> Review -> Commit lifecycle.

- Runs analysis, review, and debug protocols as needed.
- Enforces gate transitions and checkpoint saves.
- Handles parallel task suggestions when worktrees are available.

## General Rules

- Always read the project's `CLAUDE.md` before starting work.
- Respect the project's existing code style and conventions.
- When uncertain about scope, ask the user rather than guessing.
- Prefer small, focused commits over large monolithic changes.
- Never force-push to main/master without explicit user approval.
- Log all agent delegations for traceability.
