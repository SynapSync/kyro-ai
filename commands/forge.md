---
description: Full sprint cycle — Analyze → Plan → Implement → Review → Commit
argument-hint: <project path or description>
---

# /kyro-workflow:forge — Complete Kyro Cycle

Execute the full sprint lifecycle with validation gates between each phase.

## Execution

> **IMPORTANT**: This command delegates to the `orchestrator` agent.
> Do not execute phases directly — the orchestrator handles all delegation,
> skill loading, and validation gates.
>
> **The orchestrator is the single source of truth for the lifecycle.**
> See `agents/orchestrator.md` for the full detailed protocol.

## Target: $ARGUMENTS

## Lifecycle Summary (Gates Contract)

The orchestrator follows this sequence. Approval gates are enforced at the orchestrator-defined checkpoints.

### Phase 0: Detect Project State

Check if a ROADMAP exists to choose between INIT and SPRINT flow.

### INIT Flow (no ROADMAP)

- **Phase 1**: Analyze (INIT mode) — codebase exploration, findings, roadmap creation
  - GATE 1: Approve INIT summary
- **Phase 2**: First Sprint — generate Sprint 1 from roadmap
  - GATE 2: Approve sprint plan

### SPRINT Flow (ROADMAP exists)

- **Phase 3**: Generate Next Sprint — read roadmap, retro, and debt; build sprint
  - GATE 3: Approve sprint plan

### Both Flows Converge

- **Phase 4**: Implement — task by task execution with review and debug protocols
  - GATE 4: Approve implementation
- **Phase 5**: Review & Close — quality gates, retro, debt update, rule proposals

### Learning Capture

Review corrections and propose new rules for `.agents/sprint-forge/rules.md`.

## Rules

- Never skip phases or gates. The sequence is non-negotiable.
- Never proceed past a gate without explicit user approval.
- See `agents/orchestrator.md` for full gate protocol, checkpoints, validation, and failure recovery.
