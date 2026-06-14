# Agents Reference

Kyro uses one agent: the **orchestrator**. It coordinates the sprint lifecycle and owns analysis, planning, implementation, review, debugging, and checkpoint behavior.

---

## Overview

| Agent | Role | Model | Tools | Memory |
|-------|------|-------|-------|--------|
| **orchestrator** | Full cycle coordination, validation gates, and checkpoints | opus | Read, Glob, Grep, Bash, Edit, Write | project |

---

## Orchestrator

**File:** `agents/orchestrator.md`

The orchestrator coordinates the complete sprint lifecycle. It is the brain of `/kyro:forge`, manages gates, executes protocols, runs checkpoints, and handles sprint close.

### When Triggered

- `/kyro:forge` command.
- Any workflow task requiring coordinated analysis, planning, implementation, or review.

### Tools

| Tool | Usage |
|------|-------|
| Read | Read sprint files, roadmaps, rules, and code paths |
| Glob | Find project files by pattern |
| Grep | Search codebase for patterns, debug artifacts, secrets |
| Bash | Run commands, tests, quality gates, and read-only analysis |
| Edit | Modify code files during implementation |
| Write | Create sprint documents, findings, roadmaps, and re-entry prompts |

---

## Protocols

### Analysis Protocol

Used during INIT and codebase exploration. The orchestrator performs read-only analysis:

1. Detect work type: audit/refactor, new feature, bugfix, new project, or tech debt.
2. Explore architecture, code quality, dependencies, risks, and visible debt.
3. Generate findings and recommendations for the roadmap.

During analysis, the orchestrator must not edit files.

### Review Checklist

Used after each task completion during sprint execution.

**BLOCKER**

- Related tests pass when the project defines tests.
- Typecheck/build passes.
- No debug artifacts are left in production code.
- No hardcoded secrets or credentials.
- No syntax errors or broken imports.

**WARNING**

- New code has appropriate coverage when practical.
- Non-obvious logic is documented.
- New debt is tracked.
- No visible performance regressions.

**SUGGESTION**

- Code follows project conventions.
- Refactoring opportunities are noted for retro.
- Related documentation updates are identified.

### Debug Protocol

Used when a task fails validation or runtime behavior breaks:

1. Reproduce the failure.
2. Generate ranked hypotheses.
3. Investigate evidence.
4. Identify root cause.
5. Propose a fix.
6. Escalate if unresolved after three investigation rounds.

The orchestrator waits for approval before applying non-trivial fixes.

---

## Checkpoint Protocol

The orchestrator owns checkpoints directly. They are not delegated to a separate agent.

| Checkpoint | When | Purpose |
|------------|------|---------|
| startup | Start of orchestration | Load rules, detect active sprint, summarize state |
| pre-phase | Before each phase | Validate rules, sprint file, and worktree state |
| rule check | Before task execution | Detect likely violations of learned rules |
| post-edit scan | After edits | Search changed files for debug artifacts and secrets |
| task complete | After task validation | Verify task status, checkpoint, remaining work, and new debt |
| pre-commit | Before commit | Run quality gates and final post-edit scan |
| learn capture | Sprint close | Propose new rules from corrections and discoveries |

---

## Gate Protocol

At each gate, the orchestrator presents:

```text
===================================
GATE [N]: [Phase Name] Complete
===================================

Summary:
- [key outcomes from this phase]

Next phase: [what happens next]

Options:
  -> "proceed" -- continue to next phase
  -> "adjust" -- modify before continuing
  -> "cancel" -- stop the workflow
```

The orchestrator never proceeds past a gate without explicit user approval.

---

## Sprint Close Protocol

After all tasks are complete:

1. Run the pre-commit checkpoint.
2. Consolidate findings.
3. Fill the retrospective.
4. Update accumulated technical debt in markdown.
5. Update frontmatter.
6. Generate or update re-entry prompts.
7. Update roadmap if execution changed the plan.
8. Run the learn-capture checkpoint.
9. Propose new rules for `.agents/kyro/scopes/rules.md`.

---

## Constraints

- Never skip phases or gates.
- Never proceed without user approval at gates.
- If implementation reveals the plan was wrong, return to planning.
- Capture learnings and propose rules at the end of every cycle.
- Keep the user informed at each step.
