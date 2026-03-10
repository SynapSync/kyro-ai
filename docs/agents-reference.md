# Agents Reference

Kyro uses 4 specialized agents, each with a distinct role, toolset, and set of constraints. Agents are defined as markdown files in the `agents/` directory and are invoked by commands or by other agents during the sprint lifecycle.

---

## Overview

| Agent | Role | Model | Tools | Memory |
|-------|------|-------|-------|--------|
| **explorer** | Read-only codebase analysis | sonnet | Read, Glob, Grep, Bash | project |
| **reviewer** | Task quality validation | sonnet | Read, Glob, Grep, Bash | -- |
| **debugger** | Root cause investigation | opus | Read, Glob, Grep, Bash | project |
| **orchestrator** | Full cycle coordination | opus | Read, Glob, Grep, Bash, Edit, Write | project |

---

## Explorer

**File:** `agents/explorer.md`

The explorer agent performs read-only codebase analysis during the INIT phase. It investigates architecture, risks, dependencies, and visible debt without ever modifying files.

### When Triggered

- Phase 1 of `/kyro-workflow:forge` (delegated by the orchestrator)
- Directly when the user wants to analyze a project before planning

### Tools

| Tool | Usage |
|------|-------|
| Read | Examine specific files in detail |
| Glob | Find files by pattern (e.g., `**/*.ts`, `**/test/**`) |
| Grep | Search for patterns across the codebase (TODOs, deprecated APIs, etc.) |
| Bash | Run read-only commands (e.g., `npm ls`, `git log`, `wc -l`) |

### Constraints

- **NEVER edits files.** Read-only exploration only.
- **NEVER writes files.** The orchestrator handles all file creation.
- Operates in worktree isolation when available.
- Loads rules from `.agents/kyro-workflow/rules.md` and applies relevant ones during analysis.
- Uses the `kyro-analyzer` skill for analysis strategies per work type.

### Workflow

1. **Detect work type** -- classify the project intent (Audit/Refactor, New Feature, Bugfix, New Project, Tech Debt)
2. **Deep analysis** -- explore based on work type:
   - Architecture: project structure, module boundaries, dependency graph
   - Code quality: patterns, anti-patterns, consistency, test coverage
   - Dependencies: external packages, version health, security advisories
   - Risks: fragile areas, complex modules, missing tests
   - Debt: TODOs, FIXMEs, deprecated APIs, known workarounds
3. **Generate report** -- structured output with findings

### Output Format

```
EXPLORER REPORT
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

---

## Reviewer

**File:** `agents/reviewer.md`

The reviewer agent validates each task before it can be marked as completed. It enforces quality gates at the task level using a three-tier checklist.

### When Triggered

- After each task completion during sprint execution (Phase 3 of `/kyro-workflow:forge` or `/kyro-workflow:sprint execute`)
- Manually when the user requests a quality check
- Via the `TaskCompleted` hook

### Tools

| Tool | Usage |
|------|-------|
| Read | Examine changed files |
| Glob | Find related test files |
| Grep | Search for debug artifacts, secrets, broken imports |
| Bash | Run tests, linter, type checker |

### Checklist Tiers

#### BLOCKER (must pass -- blocks task closure)

These must ALL pass. If any fails, the task cannot be closed.

| Check | What It Verifies |
|-------|-----------------|
| Tests pass | All related tests run successfully |
| Type safety | No typecheck errors introduced |
| No debug artifacts | No `console.log`, `debugger`, `print` statements in production code |
| No secrets | No hardcoded API keys, passwords, tokens, or credentials |
| No broken imports | All imports resolve correctly |

#### WARNING (should pass -- requires justification)

These should pass. If they don't, the developer must provide a justification to proceed.

| Check | What It Verifies |
|-------|-----------------|
| Test coverage | New code has test coverage |
| Documentation | Non-obvious logic has inline comments |
| Debt tracking | Debt table updated if new debt was introduced |
| Performance | No visible performance regressions |

#### SUGGESTION (noted for retro -- does not block)

These are recorded for the sprint retrospective.

| Check | What It Verifies |
|-------|-----------------|
| Conventions | Code follows project patterns and naming conventions |
| Refactoring | DRY violations or simplification opportunities identified |
| Documentation | Related docs should be updated |

### Output Format

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

### Validation Commands

The reviewer adapts commands to the project stack:

```bash
# Tests
npm test -- --related
# or: pytest, go test, dart test, flutter test

# Typecheck
npm run typecheck
# or: mypy, go vet

# Lint
npm run lint
# or: ruff, golangci-lint

# Debug artifacts
grep -rn "console\.log\|debugger\|print(" src/ --include="*.ts"

# Secrets
grep -rn "apikey\|api_key\|secret\|password\|token" src/ -i
```

---

## Debugger

**File:** `agents/debugger.md`

The debugger agent performs systematic root cause analysis. It uses a hypothesis-driven workflow and escalates to the user if unable to resolve after 3 investigation rounds.

### When Triggered

- Automatically when a sprint task fails during execution (via `TaskFailed` / `PostToolUseFailure` hook)
- When the reviewer reports a BLOCKER that needs investigation
- Manually when the user encounters a hard bug, test failure, or runtime error

### Tools

| Tool | Usage |
|------|-------|
| Read | Examine code paths, stack traces, error logs |
| Glob | Find related files |
| Grep | Search for patterns, recent changes, similar bugs |
| Bash | Reproduce errors, run tests, check `git blame`, `git log` |

### Hypothesis Workflow

The debugger follows a strict investigation protocol:

#### Step 1: Reproduce

- Run the failing test or reproduce the error
- Capture the exact error message, stack trace, and context
- Determine: regression (worked before) or new behavior?

#### Step 2: Hypothesize

Generate 2-3 hypotheses ranked by likelihood:

```
Hypothesis 1 (70%): [most likely cause]
  Evidence for: [what supports this]
  Evidence against: [what contradicts]
  Test: [how to verify]

Hypothesis 2 (20%): [alternative cause]
  Evidence for: ...
  Test: ...

Hypothesis 3 (10%): [unlikely but possible]
  Evidence for: ...
  Test: ...
```

#### Step 3: Investigate

Test each hypothesis starting with the most likely:
- Read relevant code paths
- Check `git log` for recent changes to affected files
- Search for similar patterns that work correctly
- Add targeted debug output if needed

#### Step 4: Root Cause

Present the confirmed root cause:

```
ROOT CAUSE: [what is actually wrong]
WHERE: [file:line]
WHY: [how it got this way]
SINCE: [when it was introduced, if knowable]
```

#### Step 5: Fix Proposal

Propose the minimal fix with justification:

```
FIX: [description]
CHANGES:
  - file.ts:42 -- [what to change and why]
RISK: [low/medium/high]
TESTS: [how to verify the fix]
```

The debugger waits for approval before implementing any fix.

### Escalation Protocol

If unable to resolve after 3 rounds of investigation:

```
ESCALATION REPORT
Task: [task ID]
Error: [original error]
Investigated: [what was checked]
Hypotheses tested: [results]
Remaining unknowns: [what is still unclear]
Recommended next step: [suggestion for the human]
```

### Constraints

- Never guess. Investigate systematically.
- Never apply fixes without finding root cause first.
- Never use "shotgun debugging" (changing random things hoping something works).
- Never fix symptoms instead of root causes.
- Check `git blame` -- recent changes are more likely to be the cause.
- Use project memory to recall previous bugs in the same area.
- If stuck after 3 rounds, escalate with findings so far.
- Capture debugging insights as rule proposals for `.agents/kyro-workflow/rules.md`.

---

## Orchestrator

**File:** `agents/orchestrator.md`

The orchestrator coordinates the complete sprint lifecycle. It is the brain of the `/kyro-workflow:forge` command, managing gates, delegating to other agents, and handling sprint close.

### When Triggered

- `/kyro-workflow:forge` command (always)
- Indirectly manages the flow when `/kyro-workflow:sprint` runs with execution

### Tools

| Tool | Usage |
|------|-------|
| Read | Read sprint files, roadmaps, rules |
| Glob | Find project files |
| Grep | Search codebase |
| Bash | Run commands, tests, quality gates |
| Edit | Modify code files during implementation |
| Write | Create sprint documents, findings, roadmaps |

The orchestrator is the only agent with write permissions (Edit, Write).

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

1. Read `.agents/kyro-workflow/rules.md` if it exists
2. Apply relevant rules throughout all phases
3. If a rule is about to be violated, pause and show the rule to the user
4. At the end, propose new rules based on corrections made during the session

### Task Execution Protocol

During Phase 3 (Implement), for each task:

1. Read the task definition from the sprint file
2. Execute the task
3. Invoke the **reviewer** agent for validation
4. If reviewer reports BLOCKER: invoke the **debugger** agent
5. If debugger resolves: re-run reviewer
6. If debugger escalates: mark task as blocked `[!]`, move to next task
7. Write checkpoint to sprint file after each phase completes

### Sprint Close Protocol

After all tasks are complete:

1. Run findings consolidation (review all phases, list every significant discovery)
2. Fill retrospective (What Went Well, What Didn't, Surprises, New Debt)
3. Update accumulated technical debt table
4. Update frontmatter (status, dates, agents)
5. Generate/update re-entry prompts
6. Update roadmap if needed
7. Propose new rules for `.agents/kyro-workflow/rules.md`

### Constraints

- Never skip phases or gates. The sequence is non-negotiable.
- Never proceed without user approval at gates.
- If implementation reveals the plan was wrong, return to Phase 2 (Plan).
- Use project memory to recall patterns from previous sprints.
- Capture learnings and propose rules at the end of every cycle.
- Keep the user informed at each step -- no silent operations.
