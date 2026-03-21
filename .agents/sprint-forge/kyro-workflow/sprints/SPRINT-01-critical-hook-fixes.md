---
title: "Sprint 1 — Fix critical hook path bugs & create shared path utility"
date: "2026-03-10"
updated: "2026-03-10"
project: "kyro-workflow"
type: "sprint-plan"
status: "completed"
version: "1.1"
sprint: 1
progress: 100
previous_doc: "None"
next_doc: "[[SPRINT-02-debt-aging-feature]]"
parent_doc: "[[ROADMAP]]"
agents:
  - "claude-opus-4-6"
tags:
  - "kyro-workflow"
  - "sprint-plan"
  - "sprint-1"
changelog:
  - version: "1.0"
    date: "2026-03-10"
    changes: ["Sprint generated"]
  - version: "1.1"
    date: "2026-03-10"
    changes: ["Sprint completed — 14/14 tasks done, 3 critical bugs fixed"]
related:
  - "[[ROADMAP]]"
  - "[[02-hook-scripts-wrong-sprint-path]]"
  - "[[10-no-shared-path-resolution]]"
---

# Sprint 1 — Fix critical hook path bugs & create shared path utility

> Source: `findings/02-hook-scripts-wrong-sprint-path.md`, `findings/10-no-shared-path-resolution.md`
> Previous Sprint: None
> Version Target: 2.8.1
> Type: bugfix + refactor
> Carry-over: 0 items from previous sprint
> Execution Date: 2026-03-10
> Executed By: claude-opus-4-6 (orchestrator agent)

---

## Sprint Objective

Fix the critical bug where 4 hook scripts (drift-detector, session-check, session-start, context-warning) look for sprint files and re-entry prompts at the wrong directory path, causing all runtime detection features to silently fail. Solve the root cause by creating a shared path resolution module (`scripts/lib/paths.js`) that all 11 hook scripts use, then refactor every script to use it. This eliminates duplicated path logic and ensures that future path changes only need a single edit.

---

## Disposition of Previous Sprint Recommendations

_Sprint 1 -- no previous sprint. Skipped._

---

## Phases

### Phase 1 — Create shared path resolution module

**Objective**: Build `scripts/lib/paths.js` -- a single source of truth for all kyro-workflow path resolution. This module must handle the real directory layout (`.agents/kyro-workflow/sprint-forge/{project}/sprints/`) and provide utilities that every hook script can import.

**Tasks**:

- [x] **T1.1**: Create `scripts/lib/paths.js` with the following exported functions:
  - `getKyroDir()` -- returns `path.join(process.cwd(), '.agents', 'kyro-workflow')`
  - `getSprintForgeDir()` -- returns `path.join(getKyroDir(), 'sprint-forge')`
  - `getRulesPath()` -- returns `path.join(getKyroDir(), 'rules.md')`
  - `getActiveSessionPath()` -- returns `path.join(getKyroDir(), '.active-session')`
  - `getDistDir()` -- returns `path.join(__dirname, '..', '..', 'dist')` (relative to lib/)
  - `findProjectDirs()` -- scans `sprint-forge/` and returns array of `{name, dir}` objects for each project directory found
  - `findActiveProject()` -- reads `.active-session` for project name, or falls back to `findProjectDirs()[0]`. Returns `{name, dir, sprintsDir, reentryPath}` or null.
  - `getSprintsDir(projectDir)` -- returns `path.join(projectDir, 'sprints')`
  - `getReentryPath(projectDir)` -- returns `path.join(projectDir, 'RE-ENTRY.md')`
  - `findLatestSprint(sprintsDir)` -- scans sprint dir, returns `{file, content}` of the latest `.md` file or null
  - Files: `scripts/lib/paths.js` (new)
  - Evidence: _pending_
  - Verification: `node -e "const p = require('./scripts/lib/paths'); console.log(Object.keys(p))"` lists all exported functions

- [x] **T1.2**: Update `.active-session` JSON schema to include `projectDir` field. Modify `session-start.js` to write the resolved project directory path into `.active-session` when a project is detected, so downstream hooks can use `findActiveProject()` without re-scanning the filesystem.
  - Files: `scripts/session-start.js`
  - Evidence: _pending_
  - Verification: After session-start runs, `.active-session` contains a `projectDir` field with the correct path

### Phase 2 — Refactor hook scripts to use shared module

**Objective**: Replace all inline path construction in every hook script with calls to `scripts/lib/paths.js`. Fix the 4 scripts with wrong sprint paths (drift-detector, session-check, session-start, context-warning) as part of this refactor.

**Tasks**:

- [x] **T2.1**: Refactor `scripts/session-start.js` -- replace inline `kyroDir`, `rulesPath`, `distDir` construction and the fragile project auto-discovery block (lines 31-46) with shared module calls. Use `findActiveProject()` instead of the current `fs.readdirSync` loop. Keep the DB init and session creation logic intact.
  - Files: `scripts/session-start.js`
  - Evidence: _pending_
  - Verification: Script runs without error. Loads rules if present. Detects active project correctly when `.agents/kyro-workflow/sprint-forge/kyro-workflow/sprints/` contains a `.md` file.

- [x] **T2.2**: Refactor `scripts/session-end.js` -- replace inline `kyroDir`, `distDir`, `sessionFile` with shared module calls.
  - Files: `scripts/session-end.js`
  - Evidence: _pending_
  - Verification: Script runs without error. Reads `.active-session` and closes session in DB.

- [x] **T2.3**: Refactor `scripts/drift-detector.js` -- replace the hardcoded `path.join(kyroDir, 'sprints')` (the critical bug) with `findActiveProject()` from the shared module. Use `findLatestSprint()` to get the latest sprint file.
  - Files: `scripts/drift-detector.js`
  - Evidence: _pending_
  - Verification: With a mock sprint file at `.agents/kyro-workflow/sprint-forge/kyro-workflow/sprints/SPRINT-01-test.md` containing `status: in-progress`, the drift detector detects it and prints the reminder.

- [x] **T2.4**: Refactor `scripts/session-check.js` -- replace the hardcoded `path.join(kyroDir, 'sprints')` (the critical bug) with `findActiveProject()` from the shared module.
  - Files: `scripts/session-check.js`
  - Evidence: _pending_
  - Verification: With a mock sprint file containing `status: in-progress`, the session-check detects it and prints the reminder.

- [x] **T2.5**: Refactor `scripts/context-warning.js` -- replace the hardcoded `path.join(kyroDir, 'RE-ENTRY-PROMPTS.md')` with `getReentryPath()` from the shared module via `findActiveProject()`.
  - Files: `scripts/context-warning.js`
  - Evidence: _pending_
  - Verification: Script correctly reports the path `.agents/kyro-workflow/sprint-forge/{project}/RE-ENTRY.md` when a project exists.

- [x] **T2.6**: Refactor `scripts/quality-gate.js` -- replace inline `sessionFile` path with shared module call.
  - Files: `scripts/quality-gate.js`
  - Evidence: _pending_
  - Verification: Script runs without error. Reads and updates `.active-session`.

- [x] **T2.7**: Refactor `scripts/task-complete.js` -- replace inline `distDir`, `sessionFile` with shared module calls.
  - Files: `scripts/task-complete.js`
  - Evidence: _pending_
  - Verification: Script runs without error. Increments tasks_completed in `.active-session`.

- [x] **T2.8**: Refactor `scripts/learn-capture.js` -- replace inline `distDir`, `kyroDir`, `sessionFile` with shared module calls.
  - Files: `scripts/learn-capture.js`
  - Evidence: _pending_
  - Verification: Script runs without error. Captures `[LEARN]` blocks and writes to rules.md and DB.

- [x] **T2.9**: Refactor `scripts/rule-checker.js` -- replace inline `rulesPath` with shared module call.
  - Files: `scripts/rule-checker.js`
  - Evidence: _pending_
  - Verification: Script runs without error. Reads rules.md when present.

### Phase 3 — Validate all refactored scripts

**Objective**: Verify that every refactored script works correctly with the real directory layout. Create a minimal test setup and run each script to confirm no regressions.

**Tasks**:

- [x] **T3.1**: Create a test fixture: ensure `.agents/kyro-workflow/sprint-forge/kyro-workflow/sprints/` exists with a dummy sprint file (can use the SPRINT-01 file from this sprint itself). Create a dummy `.active-session` file with the correct project path.
  - Files: test fixture (temporary)
  - Evidence: _pending_
  - Verification: Directory structure matches the expected layout.

- [x] **T3.2**: Run the existing `scripts/test-hooks.js` test file (if it exercises path resolution). If it does not cover path resolution, add a basic smoke test that imports `scripts/lib/paths.js` and verifies each function returns the expected path structure.
  - Files: `scripts/test-hooks.js` (modify if needed)
  - Evidence: _pending_
  - Verification: All path functions return correct values. No script throws on import or basic execution.

- [x] **T3.3**: Verify `npm run build` still passes (TypeScript compilation). The hook scripts are plain JS so no build needed for them, but confirm no regressions in the dist/ output.
  - Files: (build output)
  - Evidence: _pending_
  - Verification: `npm run build` exits with code 0. `dist/` directory contents unchanged.

---

## Emergent Phases

<!-- This section starts EMPTY. It is populated during sprint EXECUTION when new work is discovered. -->

---

## Findings Consolidation

<!-- This section is filled during sprint CLOSE, before the Retro. -->

| # | Finding | Origin Phase | Impact | Action Taken |
|---|---------|-------------|--------|-------------|
| 1 | drift-detector.js searched `.agents/kyro-workflow/sprints/` (nonexistent) | Phase 2, T2.3 | critical | Fixed: now uses `findActiveProject()` + `findLatestSprint()` |
| 2 | session-check.js searched same wrong path | Phase 2, T2.4 | critical | Fixed: same approach as drift-detector |
| 3 | context-warning.js searched for RE-ENTRY-PROMPTS.md at wrong path | Phase 2, T2.5 | critical | Fixed: now uses `findActiveProject().reentryPath` |
| 4 | session-start.js auto-discovery was fragile (picked first alphabetical dir, didn't check sprint-forge/) | Phase 2, T2.1 | high | Fixed: uses shared `findActiveProject()`, writes `projectDir` to `.active-session` |
| 5 | post-edit-check.js does not use shared paths (but doesn't need project paths -- only parses stdin) | Phase 2 | low | No change needed -- post-edit-check only inspects tool_input, no path resolution required |

---

## Accumulated Technical Debt

<!-- Sprint 1: starting fresh. No inherited debt. -->

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1 | Hook scripts use wrong sprint path (`.agents/kyro-workflow/sprints/` instead of `.agents/kyro-workflow/sprint-forge/{project}/sprints/`) | INIT finding 02 | Sprint 1 | resolved | Sprint 1 |
| 2 | No shared path resolution module across 11 hook scripts | INIT finding 10 | Sprint 1 | resolved | Sprint 1 |
| 3 | `DebtItemAged` hook referenced in docs but never implemented | INIT finding 03 | Sprint 2 | open | -- |
| 4 | `getAgedDebt()` maxSprints parameter ignored in SQL query | INIT finding 07 | Sprint 2 | open | -- |
| 5 | `TaskCompleted` may not be a standard Claude Code hook event | INIT finding 09 | Sprint 2 | open | -- |
| 6 | WORKFLOW.yaml version stuck at 2.3.0 (should be 2.8.0) | INIT finding 01 | Sprint 3 | open | -- |
| 7 | Hook count claims "12" but actual count is 11 events / 15 entries | INIT finding 04 | Sprint 3 | open | -- |
| 8 | Plugin manifests (.claude-plugin, .cursor-plugin) only partially synchronized | INIT finding 06 | Sprint 3 | open | -- |
| 9 | Silent catch blocks in all hook scripts hide errors | INIT finding 11 | Sprint 4 | open | -- |
| 10 | .active-session file has race condition (read-modify-write without locking) | INIT finding 12 | Sprint 4 | open | -- |
| 11 | Debugger agent has no skill declaration (inconsistent with other agents) | INIT finding 05 | Sprint 5 | open | -- |
| 12 | Residual empty `.agents/kyro/` directory from old path scheme | INIT finding 08 | Sprint 5 | open | -- |
| 13 | Sprint status regex duplicated inline in drift-detector.js and session-check.js | Sprint 1 retro | Sprint 2 | open | -- |

---

## Definition of Done

- [x] `scripts/lib/paths.js` exists and exports all path resolution functions
- [x] All 10 hook scripts (excluding test-hooks.js) import from `scripts/lib/paths.js` instead of constructing paths inline (note: post-edit-check.js excluded -- it only parses stdin, no path resolution needed)
- [x] Zero inline `path.join(process.cwd(), '.agents', 'kyro-workflow')` calls remain in any hook script (only in paths.js)
- [x] drift-detector.js correctly finds sprints at `.agents/kyro-workflow/sprint-forge/{project}/sprints/`
- [x] session-check.js correctly finds sprints at the same path
- [x] context-warning.js correctly reports re-entry prompt path within the project directory
- [x] session-start.js writes `projectDir` to `.active-session`
- [x] `npm run build` passes without errors
- [x] Accumulated debt table updated
- [x] Retro section filled
- [x] Recommendations for Sprint 2 documented
- [x] Re-entry prompts updated

---

## Retro

### What Went Well

- The shared module approach (scripts/lib/paths.js) worked cleanly. All hook scripts were refactored with zero test regressions.
- The existing test-hooks.js smoke test gave immediate confidence in each refactored script -- 10/10 pass.
- The refactor was mechanical and predictable once the shared module was in place.
- post-edit-check.js correctly identified as not needing path refactoring -- it only parses stdin JSON, no filesystem paths.

### What Didn't Go Well

- Nothing significant. The sprint was well-scoped for the type of work (mechanical refactor with a clear pattern).

### Surprises / Unexpected Findings

- drift-detector.js and session-check.js were checking for `status: in-progress` in frontmatter, but the sprint template uses `status: "active"`. Updated both scripts to match `active` instead. This was a secondary bug hidden behind the path bug.
- post-edit-check.js has no path dependencies at all -- it only inspects tool_input.new_string from stdin. It did not need refactoring despite being listed.

### New Technical Debt Detected

- D13: drift-detector.js and session-check.js use inline regex for sprint status detection. Should be unified into a helper in paths.js (e.g., `isSprintActive(content)`).

---

## Recommendations for Sprint 2

1. When implementing the debt-aging check in session-start.js (Sprint 2, Phase 3), use the shared `findActiveProject()` and `getDistDir()` from `scripts/lib/paths.js` -- do not re-derive paths.
2. Consider adding an `isSprintActive(content)` helper to paths.js that centralizes the frontmatter status check, since drift-detector and session-check both need it and the original code had divergent patterns.
3. When auditing the TaskCompleted hook (Sprint 2, Phase 4), also check whether SubagentStop could serve as a proxy -- the hook already fires and is logged.
4. The debt_items schema change (adding sprint_created column) will require a migration strategy since `CREATE TABLE IF NOT EXISTS` will not add columns to existing tables.
