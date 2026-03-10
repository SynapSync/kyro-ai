---
description: Enforces sequential sprint execution, mandatory retrospectives, and debt continuity. Prevents batch-planning and ensures every recommendation is tracked across sprints.
globs: ["**/*.md"]
alwaysApply: true
---

# Sprint Discipline

Rules governing sprint lifecycle integrity. These ensure that sprints are deliberate, sequential, and accountable.

## R-SD-01: One Sprint at a Time

Always generate sprints one at a time. Never batch-generate multiple sprints in a single session.

- Each sprint depends on the outcomes and learnings of the previous one.
- Batch planning ignores emergent work and produces stale plans.
- If the user asks for "the next 3 sprints," generate Sprint N, execute it, retro it, then generate Sprint N+1.

## R-SD-02: Retro Before Next Sprint

A retrospective is mandatory before generating the next sprint.

- The retro produces recommendations, estimation corrections, and debt updates.
- These feed directly into Sprint N+1 planning.
- If no retro exists for Sprint N, refuse to generate Sprint N+1 and prompt the user to run `/kyro-workflow:retro` first.

## R-SD-03: Disposition Table Completeness

Every recommendation from Sprint N-1's retro must appear in Sprint N's disposition table.

- Valid dispositions: `ADOPTED`, `DEFERRED`, `REJECTED (reason)`, `PARTIAL (details)`
- No recommendation may be silently dropped.
- The disposition table is the first section of every sprint plan after the header.

## R-SD-04: Debt Table Inheritance

The debt table is inherited complete from the previous sprint. Never delete rows.

- New debt items are appended.
- Resolved items change status to `RESOLVED` with the sprint number and date.
- Aged items (open for more than 3 sprints) are flagged with `[AGED]`.
- The debt table is a living document — deletion is data loss.

## R-SD-05: Checkpoint After Each Phase

Save the sprint file after each phase completes.

- If context is lost mid-sprint, the last checkpoint is the recovery point.
- Checkpoints include: phase status, completed tasks, updated debt, and discovered work.
