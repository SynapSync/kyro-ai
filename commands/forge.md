---
description: Full sprint cycle — Analyze → Plan → Implement → Review → Commit
argument-hint: <project path or description>
---

# /kyro-workflow:forge — Complete Kyro Cycle

Execute the full sprint lifecycle with validation gates between each phase.

## Target: $ARGUMENTS

### Phase 1: Analyze

Delegate to the **explorer** agent:

1. Classify work type (audit, new feature, bugfix, new project, tech debt)
2. Deep analysis of codebase — architecture, risks, dependencies, visible debt
3. Generate analysis report with numbered recommendations

**GATE 1:** Present analysis findings. Wait for approval before planning.

### Phase 2: Plan

Generate the next sprint from roadmap + previous sprint + debt:

1. Load roadmap and previous sprint retro/recommendations
2. Build disposition table for all previous recommendations
3. Generate sprint phases with tasks, estimates, and dependencies
4. Identify opportunities for parallel execution (worktrees)

**GATE 2:** Present sprint plan. Wait for approval before implementing.

### Phase 3: Implement

Execute task by task with quality gates:

1. For each task:
   - Execute the task
   - Run **reviewer** agent checklist
   - If BLOCKER found → invoke **debugger** agent
   - Checkpoint after each phase completes
2. Handle emergent work — add new phases when discoveries surface
3. Pause for review every 5 edits

**GATE 3:** Present implementation summary. Wait for approval.

### Phase 4: Review & Close

1. Run full quality gates (lint, typecheck, test)
2. Fill sprint retrospective
3. Update accumulated debt table
4. Update re-entry prompts
5. Propose new rules for `.agents/kyro/rules.md`
6. Commit with conventional message

### Learning Capture

After completing, check:
- What corrections were made during implementation?
- Any patterns worth adding to learned rules?
- Any estimation errors to adjust future sprints?
