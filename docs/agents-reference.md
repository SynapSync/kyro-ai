# Agents Reference

Kyro uses two agents: an **orchestrator** that handles all phases of the sprint lifecycle, and a **guardian** that runs configurable event-based checkpoints at lifecycle moments. The orchestrator incorporates specialized protocols for each concern and invokes the guardian at key points during execution.

---

## Overview

| Agent | Role | Model | Tools | Memory |
|-------|------|-------|-------|--------|
| **orchestrator** | Full cycle coordination — analysis, review, debugging, sprint execution | opus | Read, Glob, Grep, Bash, Edit, Write | project |
| **guardian** | Event-based checkpoints — rules loading, drift detection, quality checks | opus | Read, Glob, Grep, Bash | project |

---

## Orchestrator

**File:** `agents/orchestrator.md`

The orchestrator coordinates the complete sprint lifecycle. It is the brain of the `/kyro-workflow:forge` command, managing gates, executing all protocols, and handling sprint close.

### When Triggered

- `/kyro-workflow:forge` command (always)
- Any command requiring agent coordination

### Tools

| Tool | Usage |
|------|-------|
| Read | Read sprint files, roadmaps, rules, examine code paths |
| Glob | Find project files by pattern |
| Grep | Search codebase for patterns, debug artifacts, secrets |
| Bash | Run commands, tests, quality gates, read-only analysis |
| Edit | Modify code files during implementation |
| Write | Create sprint documents, findings, roadmaps |

### Protocols

The orchestrator incorporates three specialized protocols that were previously handled by separate agents:

#### Analysis Protocol (formerly explorer agent)

Used during the INIT phase and any codebase exploration. The orchestrator performs read-only analysis:

1. **Detect work type** -- classify the project intent (Audit/Refactor, New Feature, Bugfix, New Project, Tech Debt)
2. **Deep analysis** -- explore based on work type:
   - Architecture: project structure, module boundaries, dependency graph
   - Code quality: patterns, anti-patterns, consistency, test coverage
   - Dependencies: external packages, version health, security advisories
   - Risks: fragile areas, complex modules, missing tests
   - Debt: TODOs, FIXMEs, deprecated APIs, known workarounds
3. **Generate report** -- structured output with findings

The analysis protocol uses the analyzer helper (`skills/sprint-forge/assets/helpers/analyzer.md`) for analysis strategies per work type. During analysis, the orchestrator restricts itself to read-only operations.

**Output Format:**

```
ANALYSIS REPORT
Project: [name]
Work Type: [classification]
Analyzed: [date]

## Architecture
- [key observations about project structure]

## Risks
- [risk 1 -- severity: high/medium/low]
- [risk 2]

## Dependencies
- [notable dependency concerns]

## Visible Debt
- [debt item 1]
- [debt item 2]

## Recommendations
- [numbered recommendations for the roadmap]

## Files Analyzed
- [count] files across [count] directories
```

#### Review Checklist (formerly reviewer agent)

Used after each task completion during sprint execution. The orchestrator validates each task using a three-tier checklist:

##### BLOCKER (must pass -- blocks task closure)

| Check | What It Verifies |
|-------|-----------------|
| Tests pass | All related tests run successfully |
| Type safety | No typecheck errors introduced |
| No debug artifacts | No `console.log`, `debugger`, `print` statements in production code |
| No secrets | No hardcoded API keys, passwords, tokens, or credentials |
| No broken imports | All imports resolve correctly |

##### WARNING (should pass -- requires justification)

| Check | What It Verifies |
|-------|-----------------|
| Test coverage | New code has test coverage |
| Documentation | Non-obvious logic has inline comments |
| Debt tracking | Debt table updated if new debt was introduced |
| Performance | No visible performance regressions |

##### SUGGESTION (noted for retro -- does not block)

| Check | What It Verifies |
|-------|-----------------|
| Conventions | Code follows project patterns and naming conventions |
| Refactoring | DRY violations or simplification opportunities identified |
| Documentation | Related docs should be updated |

**Output Format:**

```
REVIEW: Task T{phase}.{task} -- "{task title}"

BLOCKERS:          [0 found / N found]
  [pass] Tests passing
  [pass] Type safety
  [FAIL] Debug artifact: console.log at src/auth/login.ts:42

WARNINGS:          [0 found / N found]
  [pass] Test coverage
  [warn] Missing documentation for validateToken()

SUGGESTIONS:       [0 found / N found]
  -> Consider extracting email validation to shared util

VERDICT: PASS / FAIL (N blockers) / PASS WITH WARNINGS (N)
```

#### Debug Protocol (formerly debugger agent)

Used when a sprint task fails or tests break. The orchestrator performs systematic root cause analysis using a hypothesis-driven workflow:

##### Step 1: Reproduce

- Run the failing test or reproduce the error
- Capture the exact error message, stack trace, and context
- Determine: regression (worked before) or new behavior?

##### Step 2: Hypothesize

Generate 2-3 hypotheses ranked by likelihood:

```
Hypothesis 1 (70%): [most likely cause]
  Evidence for: [what supports this]
  Evidence against: [what contradicts]
  Test: [how to verify]

Hypothesis 2 (20%): [alternative cause]
  Evidence for: ...
  Test: ...
```

##### Step 3: Investigate

Test each hypothesis starting with the most likely:
- Read relevant code paths
- Check `git log` for recent changes to affected files
- Search for similar patterns that work correctly

##### Step 4: Root Cause

```
ROOT CAUSE: [what is actually wrong]
WHERE: [file:line]
WHY: [how it got this way]
SINCE: [when it was introduced, if knowable]
```

##### Step 5: Fix Proposal

```
FIX: [description]
CHANGES:
  - file.ts:42 -- [what to change and why]
RISK: [low/medium/high]
TESTS: [how to verify the fix]
```

The orchestrator waits for approval before implementing any fix. If unable to resolve after 3 rounds of investigation, it escalates to the user.

### Gate Protocol

At each gate, the orchestrator presents:

```
===================================
GATE [N]: [Phase Name] Complete
===================================

Summary:
- [key outcomes from this phase]

Next phase: [what happens next]

Options:
  -> "proceed" -- continue to next phase
  -> "adjust" -- modify before continuing (describe changes)
  -> "cancel" -- stop the workflow

Waiting for your decision...
```

The orchestrator never proceeds past a gate without explicit user approval.

### Rules Loading

At the start of every orchestration:

1. Read `.agents/sprint-forge/rules.md` if it exists
2. Apply relevant rules throughout all phases
3. If a rule is about to be violated, pause and show the rule to the user
4. At the end, propose new rules based on corrections made during the session

### Task Execution Protocol

During Phase 3 (Implement), for each task:

1. Read the task definition from the sprint file
2. Execute the task
3. Run the **review checklist** for validation
4. If review reports BLOCKER: run the **debug protocol**
5. If debug resolves: re-run review checklist
6. If debug escalates: mark task as blocked `[!]`, move to next task
7. Write checkpoint to sprint file after each phase completes

### Sprint Close Protocol

After all tasks are complete:

1. Run findings consolidation (review all phases, list every significant discovery)
2. Fill retrospective (What Went Well, What Didn't, Surprises, New Debt)
3. Update accumulated technical debt table
4. Update frontmatter (status, dates, agents)
5. Generate/update re-entry prompts
6. Update roadmap if needed
7. Propose new rules for `.agents/sprint-forge/rules.md`

### Constraints

- Never skip phases or gates. The sequence is non-negotiable.
- Never proceed without user approval at gates.
- If implementation reveals the plan was wrong, return to Phase 2 (Plan).
- Use project memory to recall patterns from previous sprints.
- Capture learnings and propose rules at the end of every cycle.
- Keep the user informed at each step -- no silent operations.

---

## Guardian

**File:** `agents/guardian.md`

The guardian agent runs configurable event-based checkpoints at lifecycle moments. It is invoked by the orchestrator (not directly by commands) to handle cross-cutting concerns like rules loading, drift detection, quality checks, and learning capture.

### When Triggered

- Invoked by the orchestrator at lifecycle moments during sprint execution
- Not directly triggered by user commands

### Tools

| Tool | Usage |
|------|-------|
| Read | Read rules file, sprint files, session state |
| Glob | Find project files by pattern |
| Grep | Search for patterns, debug artifacts, secrets |
| Bash | Run read-only commands for validation |

### Configurable Events (10)

The guardian handles 10 configurable events:

| Event | When | What It Does |
|-------|------|-------------|
| `session_start` | New session begins | Load learned rules from `.agents/sprint-forge/rules.md`, show active sprint |
| `pre_tool_use` | Before edits or git commit | Track edit count, remind about quality gates |
| `post_tool_use` | After code edits or tests | Check for debug artifacts, secrets, TODOs; detect test failures |
| `stop` | Each response | Session check, capture `[LEARN]` blocks |
| `session_end` | Session close | Save stats, prompt for learnings |
| `user_prompt_submit` | Each prompt | Drift detection, rule violation check |
| `pre_compact` | Before context compaction | Save re-entry state |
| `subagent_start` | Agent starts | Log for observability |
| `subagent_stop` | Agent stops | Log completion |
| `task_completed` | Task marked done | Post-task quality checklist |

### Rules Loading

At `session_start`, the guardian:

1. Reads `.agents/sprint-forge/rules.md` if it exists
2. Parses all active rules
3. Makes them available to the orchestrator for the session

### Drift Detection

At `user_prompt_submit`, the guardian:

1. Checks the current prompt against the active sprint plan
2. Detects if the user is drifting from the planned work
3. Warns about potential rule violations

### Learn Capture

At `stop`, the guardian:

1. Scans the response for `[LEARN]` blocks
2. Proposes new rules based on corrections made during the session
3. Logs learnings to the database
