---
description: End-of-session closure ritual with quality check and context handoff
argument-hint: [session notes]
---

# /kyro-workflow:wrap-up — Session Closure Ritual

Structured 5-step checklist to close the current session cleanly. Ensures no work is lost, quality is maintained, learnings are captured, and the next session has full context.

## Execution

> **IMPORTANT**: Before running the closure ritual, read the handoff skill:
> 1. Read `skills/kyro-handoff/SKILL.md` — context transfer format and checklist

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
4. Learnings are automatically persisted to both `.agents/kyro/rules.md` and the database

### Step 4: Next Session Context

Generate a context note for the next session:

1. **What was being worked on**: Current task/sprint, files modified
2. **What's done**: Tasks completed this session
3. **What's next**: Remaining tasks, next priorities
4. **Blockers**: Any unresolved issues or decisions needed
5. If a sprint is active, update re-entry prompts with current state

### Step 5: Session Summary

Display session stats:

1. Query the database for the active session:
   - Session duration (started_at → now)
   - Tasks completed count
   - Learnings captured count
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
3. Close the session in the database

### Output

After completing all 5 steps:
1. Display the summary
2. Confirm session is ready to close
3. Suggest using `/kyro-workflow:retro` if a sprint milestone was reached
