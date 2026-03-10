---
description: Full sprint cycle — Analyze → Plan → Implement → Review → Commit
argument-hint: <project path or description>
---

# /kyro-workflow:forge — Complete Kyro Cycle

Execute the full sprint lifecycle with validation gates between each phase.

## Execution

> **IMPORTANT**: Spawn the `orchestrator` agent to coordinate this cycle.
> Do not execute phases directly — the orchestrator handles all delegation,
> skill loading, and validation gates.

## Target: $ARGUMENTS

### Phase 0: Detect Project State

Before anything else, the orchestrator must determine the project state:

1. Scan `.agents/kyro-workflow/sprint-forge/` for existing project directories
2. Check if a `ROADMAP.md` exists for this project

**If NO ROADMAP exists** → This is a new project. Run **INIT flow** (Phases 1-2 below).
**If ROADMAP exists** → This is an existing project. Skip to **SPRINT flow** (Phase 3 below).

---

## INIT Flow (new project — no ROADMAP)

### Phase 1: Analyze (INIT mode)

The orchestrator delegates to the **explorer** agent and follows the sprint-forge INIT mode:

1. Detect work type (audit, new feature, bugfix, new project, tech debt)
2. Resolve configuration — project name, codebase path, output directory
3. Deep analysis of codebase — architecture, risks, dependencies, visible debt
4. Generate findings as individual files in `{output_kyro_dir}/findings/`
5. Create adaptive ROADMAP from findings — sprints, phases, dependencies
6. Scaffold project directory — README, ROADMAP, findings/, sprints/
7. Generate re-entry prompts

**GATE 1:** Present INIT summary (findings count, sprints planned, files created). Wait for approval.

### Phase 2: First Sprint

After INIT completes and is approved, generate Sprint 1:

1. Read ROADMAP and finding files for Sprint 1
2. Generate sprint document using sprint-forge SPRINT mode
3. Write to `{output_kyro_dir}/sprints/SPRINT-01-{slug}.md`

**GATE 2:** Present sprint plan. Wait for approval before implementing.

Then continue to **Phase 4: Implement** below.

---

## SPRINT Flow (existing project — ROADMAP exists)

### Phase 3: Generate Next Sprint

The orchestrator follows the sprint-forge SPRINT mode:

1. Locate output directory from re-entry prompts or auto-discovery
2. Determine sprint number from existing sprint files
3. Read ROADMAP section + previous sprint retro/recommendations + finding files
4. Build disposition table for all previous recommendations (Sprint 2+)
5. Generate sprint phases with tasks, estimates, and dependencies
6. Write sprint document

**GATE 3:** Present sprint plan. Wait for approval before implementing.

---

## Implementation (both flows converge here)

### Phase 4: Implement

Execute task by task with quality gates:

1. For each task:
   - Execute the task
   - Run **reviewer** agent checklist (BLOCKER/WARNING/SUGGESTION)
   - If BLOCKER found → invoke **debugger** agent
   - Checkpoint after each phase completes (write sprint file to disk)
2. Handle emergent work — add new phases when discoveries surface
3. Pause for review every 5 edits

**GATE 4:** Present implementation summary. Wait for approval.

### Phase 5: Review & Close

1. Run full quality gates (lint, typecheck, test)
2. Consolidate findings
3. Fill sprint retrospective (What Went Well, What Didn't, Surprises, New Debt)
4. Update accumulated debt table
5. Update re-entry prompts
6. Update roadmap if execution revealed changes
7. Propose new rules for `.agents/kyro-workflow/rules.md`
8. Commit with conventional message

### Learning Capture

After completing, check:

- What corrections were made during implementation?
- Any patterns worth adding to learned rules?
- Any estimation errors to adjust future sprints?
