---
description: End-of-session closure ritual with quality check and context handoff
argument-hint: [session notes]
---

# /kyro:wrap-up — Session Closure Ritual

Structured 5-step checklist to close the current session cleanly. Ensures no work is lost, quality is maintained, learnings are captured, and the next session has full context.

## Execution

> **IMPORTANT**: Before running the closure ritual:
> 1. Read `skills/core/assets/helpers/handoff.md` — context transfer format and checklist
> 2. Run the orchestrator's session-end checkpoint — check uncommitted changes, sprint progress, and pending learnings

## Session Notes: $ARGUMENTS

### Step 1: Changes Audit

Check for uncommitted or unsaved work:

1. Run `git status` — list modified, staged, and untracked files
2. Run `git stash list` — check for stashed work
3. If there are uncommitted changes:
   - Ask: "Should I commit these changes before closing?"
   - If yes, create a descriptive commit
   - If no, document the uncommitted state in step 4

### Step 2: Quality Check

Run quality gates from `config.json`:

1. **Lint**: Run the project's lint command (if configured)
2. **Typecheck**: Run the project's typecheck command (if configured)
3. **Tests**: Run related tests (if configured)
4. Report results — if failures exist, ask whether to fix now or defer

### Step 3: Learning Capture

Prompt for learnings from this session:

1. Review corrections made during the session — any patterns?
2. Review unexpected discoveries — worth capturing?
3. For each learning, format as:
   ```
   [LEARN] Category: One-line rule
   ```
4. Learnings are proposed for `.agents/kyro/scopes/rules.md` and recorded in the sprint retro after approval

### Step 4: Next Session Context

Generate a context note for the next session:

1. **What was being worked on**: Current task/sprint, files modified
2. **What's done**: Tasks completed this session
3. **What's next**: Remaining tasks, next priorities
4. **Blockers**: Any unresolved issues or decisions needed
5. If a sprint is active, update re-entry prompts with current state

### Step 5: Session Summary

Display session summary:

1. Inspect sprint artifacts and git history for current progress:
   - Tasks completed this session
   - Learnings proposed or captured
   - Commits created this session
2. Display summary table:
   ```
   Session Summary
   ───────────────────────
   Duration:    {time}
   Tasks:       {completed}/{total}
   Learnings:   {count} captured
   Commits:     {count} this session
   Status:      {clean/uncommitted changes}
   ```
3. Confirm the handoff and re-entry prompts reflect the current state

### Output

After completing all 5 steps:
1. Display the summary
2. Confirm session is ready to close
3. Suggest running `/kyro:forge` if a sprint milestone was reached and a retrospective is needed
