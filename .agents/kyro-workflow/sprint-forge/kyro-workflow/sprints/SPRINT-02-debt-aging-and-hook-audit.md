---
title: "Sprint 2 — Implement debt-aging feature, fix DB query, audit TaskCompleted hook"
date: "2026-03-10"
updated: "2026-03-10"
project: "kyro-workflow"
type: "sprint-plan"
status: "completed"
version: "1.0"
sprint: 2
progress: 100
previous_doc: "[[SPRINT-01-critical-hook-fixes]]"
next_doc: "[[SPRINT-03-version-sync]]"
parent_doc: "[[ROADMAP]]"
agents:
  - "claude-opus-4-6"
tags:
  - "kyro-workflow"
  - "sprint-plan"
  - "sprint-2"
changelog:
  - version: "1.0"
    date: "2026-03-10"
    changes: ["Sprint generated"]
related:
  - "[[ROADMAP]]"
  - "[[SPRINT-01-critical-hook-fixes]]"
  - "[[03-ghost-hook-debt-item-aged]]"
  - "[[07-getAgedDebt-unused-parameter]]"
  - "[[09-no-task-hook-in-claude-code]]"
---

# Sprint 2 — Implement debt-aging feature, fix DB query, audit TaskCompleted hook

> Source: `findings/03-ghost-hook-debt-item-aged.md`, `findings/07-getAgedDebt-unused-parameter.md`, `findings/09-no-task-hook-in-claude-code.md`
> Previous Sprint: SPRINT-01-critical-hook-fixes (completed)
> Version Target: 2.8.2
> Type: feature + bugfix
> Carry-over: D13 (inline status regex duplication) from Sprint 1
> Execution Date: 2026-03-10
> Executed By: claude-opus-4-6

---

## Disposition of Sprint 1 Recommendations

| # | Recommendation | Disposition | Sprint 2 Phase |
|---|---------------|-------------|-----------------|
| R1 | Use shared `findActiveProject()` and `getDistDir()` for debt-aging check | **Accepted** — Phase 3 will use these exclusively | Phase 3 |
| R2 | Add `isSprintActive(content)` helper to paths.js (centralizes status regex, addresses D13) | **Accepted** — Phase 3 will add helper and refactor drift-detector + session-check | Phase 3 |
| R3 | Check SubagentStop as proxy for TaskCompleted | **Accepted** — Phase 4 will audit both events | Phase 4 |
| R4 | Schema migration strategy for sprint_created column (CREATE TABLE IF NOT EXISTS won't add columns) | **Accepted** — Phase 1 will use ALTER TABLE with a try/catch guard for idempotency | Phase 1 |

---

## Phases

### Phase 1 — Schema migration: add sprint_created column and update store

**Objective**: Add the `sprint_created` column to the `debt_items` table so that debt age can be calculated. Update the TypeScript store to populate and use this field. Handle existing databases that already have the table without the column.

**Tasks**:

- [x] **T1.1**: Add `sprint_created TEXT` column to `debt_items` table in `src/db/schema.sql`. Place it after `sprint_target`. This column records the sprint identifier during which the debt item was first logged (e.g., `"SPRINT-01-critical-hook-fixes"`).
  - Files: `src/db/schema.sql`
  - Evidence: Column added after sprint_target in CREATE TABLE statement
  - Verification: Column appears in schema definition with appropriate type

- [x] **T1.2**: Create a migration block in `src/db/index.ts` that runs `ALTER TABLE debt_items ADD COLUMN sprint_created TEXT` inside a try/catch. If the column already exists, SQLite will throw "duplicate column name" which we silently catch. This is idempotent — safe to run on both new and existing databases.
  - Files: `src/db/index.ts`
  - Evidence: try/catch ALTER TABLE block added after schema exec
  - Verification: Running `initDatabase()` twice does not throw. New databases get the column from CREATE TABLE. Existing databases get it from ALTER TABLE.

- [x] **T1.3**: Update the `DebtItem` interface in `src/db/store.ts` to include `sprint_created?: string`.
  - Files: `src/db/store.ts` (line 27-38)
  - Evidence: Field added to interface
  - Verification: TypeScript compiles without errors. Interface matches schema.

- [x] **T1.4**: Update `addDebtItem()` in `src/db/store.ts` to include `sprint_created` in the INSERT statement and default parameter.
  - Files: `src/db/store.ts` (line 109-123)
  - Evidence: sprint_created added to INSERT columns, VALUES, and defaults
  - Verification: addDebtItem with sprint_created value inserts correctly.
  - Verification: `addDebtItem({project: "test", item: "test", origin: "test", sprint_created: "SPRINT-01"})` inserts with the sprint_created value.

- [x] **T1.5**: Run `npm run build` to verify TypeScript compilation passes after schema and store changes.
  - Files: (build output)
  - Evidence: Build succeeded with 0 errors, postbuild copied schema.sql to dist/
  - Verification: `npm run build` exits with code 0.

### Phase 2 — Fix getAgedDebt() to actually filter by sprint age

**Objective**: Make the `getAgedDebt()` function work as documented — return only debt items that have been open for more than `maxSprints` sprints. Use the new `sprint_created` column to calculate age.

**Tasks**:

- [x] **T2.1**: Rewrite the `getAgedDebt()` SQL query in `src/db/store.ts` to filter using `sprint_created`. The approach: count the number of distinct sprints in the `sessions` table that occurred after the debt item's `sprint_created` value. Items where that count >= `maxSprints` are considered aged. Items with NULL `sprint_created` (legacy data) should be included as aged (conservative — assume they are old).
  - Files: `src/db/store.ts` (line 141-153)
  - Evidence: Subquery counts distinct sprints after sprint_created; NULL sprint_created items always included
  - Verification: Query returns only items open for > maxSprints. Items with sprint_created = current sprint are NOT returned.

- [x] **T2.2**: Run `npm run build` to verify the updated query compiles.
  - Files: (build output)
  - Evidence: Build succeeded with 0 errors
  - Verification: `npm run build` exits with code 0.

### Phase 3 — Implement debt-aging check in session-start + add isSprintActive helper

**Objective**: Wire the debt-aging feature into the session lifecycle. When a session starts and a project with open debt is detected, check for aged items and log a warning. Also add the `isSprintActive(content)` helper to paths.js (resolving D13) and refactor the two scripts that duplicate the status regex.

**Tasks**:

- [x] **T3.1**: Add `isSprintActive(content)` function to `scripts/lib/paths.js`. This function takes sprint file content (string) and returns `true` if the frontmatter contains `status: "active"` (matching the regex `/status:\s*["']?active["']?/i`). Export it from the module.
  - Files: `scripts/lib/paths.js`
  - Evidence: Function added and exported. Single source of truth for status regex.
  - Verification: `isSprintActive('---\nstatus: "active"\n---')` returns true. `isSprintActive('---\nstatus: "completed"\n---')` returns false.

- [x] **T3.2**: Refactor `scripts/drift-detector.js` to use `isSprintActive()` from the shared module instead of the inline regex.
  - Files: `scripts/drift-detector.js`
  - Evidence: Imports isSprintActive, replaced inline regex. Grep confirms 0 inline matches in scripts/.
  - Verification: Drift detection still works. No inline status regex remains.

- [x] **T3.3**: Refactor `scripts/session-check.js` to use `isSprintActive()` from the shared module instead of the inline regex.
  - Files: `scripts/session-check.js`
  - Evidence: Imports isSprintActive, replaced inline regex. Grep confirms 0 inline matches in scripts/.
  - Verification: Session check still works. No inline status regex remains.

- [x] **T3.4**: Add a debt-aging check to `scripts/session-start.js`. After the existing session creation block, if a project is detected: (1) import `getAgedDebt` from the store, (2) call `store.getAgedDebt(project, config.sprint.debt_aged_threshold_sprints)`, (3) if results are non-empty, log each aged item to stderr with `[Kyro] Aged debt: {item} (open since {sprint_created})`. Use `getDistDir()` for the store import path (per Sprint 1 R1). Read config.json for the threshold value, defaulting to 3 if config is unavailable.
  - Files: `scripts/session-start.js`
  - Evidence: Reads config.json for threshold (defaults to 3), calls store.getAgedDebt(), logs each aged item.
  - Verification: When aged debt items exist in the DB, session-start prints warnings. When no aged items exist, no warnings are printed.

### Phase 4 — Audit TaskCompleted hook and determine replacement strategy

**Objective**: Determine whether Claude Code fires the `TaskCompleted` event. If it does not, decide on a replacement strategy. The `SubagentStop` event is the primary candidate since it fires when subagents finish work.

**Tasks**:

- [x] **T4.1**: Audit `hooks/hooks.json` for the `TaskCompleted` entry. Check Claude Code's documented hook events (SessionStart, PreToolUse, PostToolUse, PostToolUseFailure, PreCompact, Stop, SessionEnd, UserPromptSubmit, SubagentStart, SubagentStop). Confirm that `TaskCompleted` is NOT in this list. Document the finding in the sprint file.
  - Files: `hooks/hooks.json` (line 152-163)
  - Evidence: **Confirmed: TaskCompleted is NOT a standard Claude Code hook event.** Standard events are: SessionStart, PreToolUse, PostToolUse, PostToolUseFailure, PreCompact, Stop, SessionEnd, UserPromptSubmit, SubagentStart, SubagentStop. The TaskCompleted entry was a phantom that would never fire.
  - Verification: Documented.

- [x] **T4.2**: Based on T4.1 findings, chose option **(a)**: Moved task-complete.js to fire on SubagentStop. Added as second entry in SubagentStop array. Removed the entire TaskCompleted key from hooks.json.
  - Files: `hooks/hooks.json`
  - Evidence: TaskCompleted key removed, task-complete.js added to SubagentStop. Grep confirms 0 occurrences of "TaskCompleted" in hooks.json.
  - Verification: hooks.json contains only standard Claude Code hook events.

- [x] **T4.3**: Adapted `scripts/task-complete.js` to handle SubagentStop payload. Changed `input.task_id` to `input.agent_name || input.task_id` (with fallback for backwards compat). Changed log line to "Agent finished:" instead of "Task completed:".
  - Files: `scripts/task-complete.js`
  - Evidence: Script reads agent_name from SubagentStop payload, falls back to task_id.
  - Verification: task-complete.js handles SubagentStop JSON payload without errors. Logs the agent name.

- [x] **T4.4**: Run `npm run build` and `node scripts/test-hooks.js` to verify no regressions from hooks.json changes.
  - Files: (test output)
  - Evidence: Build: 0 errors. Hooks: 10 passed, 0 failed, 10 total.
  - Verification: Build passes. Hook tests pass (10/10).

---

## Emergent Phases

<!-- This section starts EMPTY. It is populated during sprint EXECUTION when new work is discovered. -->

---

## Findings Consolidation

<!-- This section is filled during sprint CLOSE, before the Retro. -->

| # | Finding | Origin Phase | Impact | Action Taken |
|---|---------|-------------|--------|-------------|
| F1 | TaskCompleted confirmed non-standard | Phase 4, T4.1 | high | Moved to SubagentStop |
| F2 | SubagentStop fires for all agents, not just tasks | Phase 4, T4.3 | low | Accepted; logged as D14 |
| F3 | getAgedDebt depends on session sprint names | Phase 2, T2.1 | medium | Accepted; logged as D15 |

---

## Accumulated Technical Debt

<!-- Inherited from Sprint 1 (13 items). Items D3, D4, D5, D13 are targeted by this sprint. -->

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1 | Hook scripts use wrong sprint path | INIT finding 02 | Sprint 1 | resolved | Sprint 1 |
| 2 | No shared path resolution module | INIT finding 10 | Sprint 1 | resolved | Sprint 1 |
| 3 | `DebtItemAged` hook referenced but never implemented | INIT finding 03 | Sprint 2 | resolved | Sprint 2 |
| 4 | `getAgedDebt()` maxSprints parameter ignored in SQL query | INIT finding 07 | Sprint 2 | resolved | Sprint 2 |
| 5 | `TaskCompleted` may not be a standard Claude Code hook event | INIT finding 09 | Sprint 2 | resolved | Sprint 2 |
| 6 | WORKFLOW.yaml version stuck at 2.3.0 (should be 2.8.0) | INIT finding 01 | Sprint 3 | open | -- |
| 7 | Hook count claims "12" but actual count is 11 events / 15 entries | INIT finding 04 | Sprint 3 | open | -- |
| 8 | Plugin manifests only partially synchronized | INIT finding 06 | Sprint 3 | open | -- |
| 9 | Silent catch blocks in all hook scripts hide errors | INIT finding 11 | Sprint 4 | open | -- |
| 10 | .active-session file has race condition (read-modify-write without locking) | INIT finding 12 | Sprint 4 | open | -- |
| 11 | Debugger agent has no skill declaration | INIT finding 05 | Sprint 5 | open | -- |
| 12 | Residual empty `.agents/kyro/` directory from old path scheme | INIT finding 08 | Sprint 5 | open | -- |
| 13 | Sprint status regex duplicated inline in drift-detector.js and session-check.js | Sprint 1 retro | Sprint 2 | resolved | Sprint 2 |

---

## Definition of Done

- [x] `src/db/schema.sql` includes `sprint_created TEXT` column in `debt_items` table
- [x] `src/db/index.ts` includes idempotent ALTER TABLE migration for existing databases
- [x] `DebtItem` interface in `store.ts` includes `sprint_created` field
- [x] `addDebtItem()` populates `sprint_created`
- [x] `getAgedDebt()` filters by sprint age using `sprint_created` and `maxSprints`
- [x] `scripts/lib/paths.js` exports `isSprintActive(content)` helper
- [x] `scripts/drift-detector.js` uses `isSprintActive()` (no inline regex)
- [x] `scripts/session-check.js` uses `isSprintActive()` (no inline regex)
- [x] `scripts/session-start.js` logs aged debt warnings on session start
- [x] `TaskCompleted` phantom hook resolved (removed or confirmed working)
- [x] `hooks/hooks.json` contains only standard Claude Code hook events
- [x] `npm run build` passes without errors
- [x] `node scripts/test-hooks.js` passes without regressions
- [x] Accumulated debt table updated
- [x] Retro section filled
- [x] Recommendations for Sprint 3 documented
- [x] Re-entry prompts updated

---

## Retro

<!-- Filled during sprint CLOSE. -->

### What Went Well

- All 4 Sprint 1 recommendations were cleanly absorbed into the sprint plan via the disposition table
- The `isSprintActive()` helper eliminated duplicated regex across 2 scripts in a single pass
- Schema migration strategy (ALTER TABLE + try/catch) is simple and idempotent
- Moving TaskCompleted to SubagentStop required minimal code change -- the script was well-isolated
- 15/15 tasks completed, 10/10 hook tests passing, 0 build errors

### What Didn't Go Well

- Nothing significant blocked progress this sprint

### Surprises / Unexpected Findings

- The `getAgedDebt()` subquery approach (counting distinct sprints from sessions table) depends on sessions being recorded with sprint names. If session-start.js fails to detect the sprint name, the age calculation will undercount. This is acceptable for now but worth monitoring.
- task-complete.js now fires on every SubagentStop, not just task completions. This is noisier but ensures the quality checklist is never silently skipped.

### New Technical Debt Detected

- D14: task-complete.js fires on all SubagentStop events, not just task-related ones. May need filtering by agent_name pattern in a future sprint.
- D15: getAgedDebt() depends on sessions table having sprint names populated. If session-start fails to detect sprint, age calculation is inaccurate.

---

## Recommendations for Sprint 3

1. When synchronizing versions across manifests (WORKFLOW.yaml, package.json, plugin.json files), add the version string to a single source-of-truth location and read from it -- do not rely on manual sync.
2. The `scripts/check-sync.js` validation script (ROADMAP Phase 2) should check for TaskCompleted or other phantom hook events to prevent regression.
3. When counting hooks for documentation, distinguish between "hook events" (unique keys in hooks.json) and "hook entries" (total array elements) to avoid future mismatch.
4. Consider reading `hooks/hooks.json` programmatically in check-sync.js to get the true event count rather than hardcoding it.
