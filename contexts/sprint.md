---
name: sprint
description: Execution context for task-by-task sprint implementation with quality gates, review validation, and emergent phase handling.
mode: execution
agent: orchestrator
model: opus
---

# Context: SPRINT — Execution Mode

Activated during sprint implementation. This context puts Kyro in **active execution mode** where tasks are implemented one by one with quality validation at each step.

## When Active

- `/kyro-workflow:forge` Phase 3 (Implement)
- Resuming a sprint from a checkpoint

## Behavior

### Task Execution Loop

For each task in the sprint plan:

1. **Execute** — Implement the task according to its description and acceptance criteria.
2. **Checkpoint** — Save the sprint file after the task completes.
3. **Review** — Run the **review checklist** for quality validation.
4. **Resolve** — If the review finds BLOCKERs, run the **debug protocol**.
5. **Record** — Log actual time, notes, and any discovered work.

### Quality Gates

Quality gates run after every task (not just at the end):

- Lint: `npm run lint` (or project-configured command)
- Typecheck: `npm run typecheck` (or project-configured command)
- Tests: `npm test -- --related` (scoped to changed files)

A task is not closed until all gates pass or WARNINGs are explicitly justified.

### Emergent Phases

When implementation reveals work not in the original plan:

1. Document the discovery in the sprint file under "Emergent Work."
2. Assess impact on remaining tasks and timeline.
3. If the emergent work is a prerequisite for planned tasks, insert a new phase.
4. If it is independent, add it to the backlog or current sprint (with user approval).

### Review Validation

The **review checklist** runs after each task:

- Does the change match the task description?
- Are there regressions?
- Are quality gates passing?
- Is there new debt to track?
- Any SUGGESTION-level improvements?

### Debug on Failure

When a task fails (tests break, type errors, runtime errors):

1. Automatically run the **debug protocol**.
2. The orchestrator performs root cause analysis.
3. Fix is applied and the task re-enters the review cycle.
4. If the debug protocol cannot resolve, escalate to the user.

## Delegation

- **Primary agent**: orchestrator (coordinates the full flow)
- **Review checklist**: run after each task
- **Debug protocol**: run on failure
- Tools: all tools available (Read, Write, Edit, Glob, Grep, Bash)

## Output

The context produces:

- Updated sprint file with task statuses, actuals, and notes
- Checkpoints after each phase
- Emergent work documentation
- Quality gate results per task

## Rules in Effect

- All rules from `rules/quality-gates.md` (mandatory)
- All rules from `rules/sprint-discipline.md` (checkpoints, debt inheritance)
- All rules from `rules/estimation.md` (track actuals vs estimates)
- All rules from `rules/context-persistence.md` (checkpoints, handoffs)
- All rules from `rules/learning-rules.md` (capture corrections in real time)
