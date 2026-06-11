---
description: Full sprint cycle — Analyze → Plan → Implement → Review → Commit
argument-hint: <project path or description>
---

# /kyro-workflow:forge — Complete Kyro Cycle

Execute the full sprint lifecycle through the `orchestrator` agent.

## Execution

> **IMPORTANT**: Spawn the `orchestrator` agent to coordinate this cycle.
> Do not execute phases directly — the orchestrator handles all delegation,
> skill loading, project-state detection, validation gates, checkpoints,
> review, and closeout.

## Target: $ARGUMENTS

## Delegation Contract

Pass the target argument to the orchestrator exactly as provided:

```text
Target: $ARGUMENTS
Command: /kyro-workflow:forge
Coordinator: orchestrator
```

The lifecycle definition lives in `agents/orchestrator.md`. Keep this command file thin so the workflow has one source of truth.
