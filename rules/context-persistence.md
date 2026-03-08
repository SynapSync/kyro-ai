---
description: Governs re-entry prompt management, context compaction safety, and session handoff procedures. Ensures zero mental context loss between sessions.
globs: ["**/*.md"]
alwaysApply: true
---

# Context Persistence

Rules governing how mental context is preserved across sessions and compaction events.

## R-CP-01: Update Re-Entry Prompts at Milestones

Update re-entry prompts after INIT completes and after each executed sprint.

- Re-entry prompts live in the project's sprint output directory.
- They must contain: current sprint number, phase, last completed task, active debt items, and output directory path.
- Stale re-entry prompts are worse than no prompts — they cause misaligned execution.

## R-CP-02: Save State Before Compaction

Save re-entry state before context compaction occurs.

- The `PreCompact` hook triggers this automatically.
- State includes: current phase, task index, in-progress work, and any uncommitted decisions.
- If compaction happens without a save, the session must restart from the last checkpoint.

## R-CP-03: Handoff Document on Mid-Sprint Exit

Generate a handoff document when ending a session mid-sprint.

- The handoff must include:
  - Current sprint and phase
  - Last completed task and next pending task
  - Any in-flight decisions or blockers
  - Modified files not yet committed
  - Active debt items relevant to current work
- Use the `sprint-handoff` skill to generate enriched handoffs with mental model context.

## R-CP-04: Re-Entry Prompts Are Source of Truth

Re-entry prompts are the authoritative source for output directory paths.

- Never hardcode or guess output paths — always read from the re-entry prompt.
- If the re-entry prompt is missing or corrupted, ask the user to confirm the output directory before proceeding.
- Output directory format: `{cwd}/.agents/sprint-forge/{project}/`

## R-CP-05: Session Continuity Verification

When resuming a session, verify continuity:

1. Read the re-entry prompt.
2. Confirm the sprint file exists and matches the expected state.
3. Check for any handoff documents from the previous session.
4. If state is inconsistent, present the discrepancy to the user before proceeding.
