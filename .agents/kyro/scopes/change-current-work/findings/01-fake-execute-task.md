---
summary: Handoff can advertise execute_task when no task is dependency-ready
severity: HIGH
---

# Fake execute_task

After a terminal disposition or temporary block, `record-evidence` sets `nextAction` to `execute_task` even when there is no ready task and no pending review (`src/cli/commands/record-evidence.ts:259`). `plan --update-active` only overwrites handoff when `nextExecutableTaskId` is non-null, so a dead route can stick.

**User-visible:** Disciplined agents freeze instead of correcting live work.

**Recommendation:** Recompute handoff from execution state. Never emit `execute_task` without a ready `nextTaskId`. Expose structured `blocker.remedyCommand` on status/context-pack/envelope.

**Validation:** Fixture that disposes the last unfinished task; `status --json` must not show `execute_task` without a ready id.
