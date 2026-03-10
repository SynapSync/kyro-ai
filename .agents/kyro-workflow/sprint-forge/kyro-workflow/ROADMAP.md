---
title: "Roadmap: kyro-workflow self-audit"
date: "2026-03-10"
updated: "2026-03-10"
project: "kyro-workflow"
type: "roadmap"
status: "active"
version: "1.0"
agents:
  - "claude-opus-4-6"
tags:
  - "kyro-workflow"
  - "roadmap"
  - "audit"
changelog:
  - version: "1.0"
    date: "2026-03-10"
    changes: ["Roadmap created from 12 findings"]
  - version: "1.1"
    date: "2026-03-10"
    changes: ["Sprint 1 completed. Added Sprint 2 note about isSprintActive helper and schema migration."]
  - version: "1.2"
    date: "2026-03-10"
    changes: ["Sprint 2 completed. 15/15 tasks. Debt-aging feature implemented, TaskCompleted phantom removed."]
  - version: "1.3"
    date: "2026-03-10"
    changes: ["Sprint 3 completed. 13/13 tasks. Version sync, phantom dirs removed, check-sync.js created."]
  - version: "1.4"
    date: "2026-03-10"
    changes: ["Sprint 4 completed. 17/17 tasks. debugLog, writeJsonAtomic, readActiveSession added to paths.js."]
---

# Roadmap: kyro-workflow self-audit

## Project Configuration

| Key | Value |
|-----|-------|
| **Project** | kyro-workflow |
| **Type** | Audit / Self-repair |
| **Codebase** | `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace` |
| **Output** | `.agents/kyro-workflow/sprint-forge/kyro-workflow/` |
| **Findings** | 12 |
| **Sprints** | 5 |

---

## Sprint Summary

| Sprint | Title | Findings | Type | Status |
|--------|-------|----------|------|--------|
| 1 | Fix critical hook path bugs & create shared path utility | 02, 10 | bugfix + refactor | completed |
| 2 | Implement missing debt-aging feature & fix DB query | 03, 07, 09 | feature + bugfix | completed |
| 3 | Version & count synchronization across all manifests | 01, 04, 06 | sync-fix | completed |
| 4 | Harden hook scripts: debug mode, atomic writes, validation | 11, 12 | quality | completed |
| 5 | Cleanup: debugger skill gap, old directory, docs alignment | 05, 08 | cleanup | pending |

---

## Sprint Details

### Sprint 1: Fix critical hook path bugs & create shared path utility -- COMPLETED

**Source findings**: 02-hook-scripts-wrong-sprint-path.md, 10-no-shared-path-resolution.md
**Priority**: Critical -- hooks are silently broken today
**Actual phases**: 3 (matched estimate)
**Result**: 14/14 tasks completed. Created `scripts/lib/paths.js` (10 functions). Refactored 9 hook scripts. Fixed 3 critical path bugs + 1 secondary status-regex bug. New debt item D13 (inline status regex duplication).

- Phase 1: Created `scripts/lib/paths.js` shared module. Updated `.active-session` schema with `projectDir`.
- Phase 2: Refactored 9 hook scripts (post-edit-check.js excluded -- no path dependencies). Fixed drift-detector.js, session-check.js, context-warning.js critical bugs.
- Phase 3: Validated with test-hooks.js (10/10 pass) + 13 path assertion tests + npm build.

### Sprint 2: Implement missing debt-aging feature & fix DB query -- COMPLETED

**Source findings**: 03-ghost-hook-debt-item-aged.md, 07-getAgedDebt-unused-parameter.md, 09-no-task-hook-in-claude-code.md
**Priority**: High -- promised features that do not work
**Actual phases**: 4 (matched estimate)
**Result**: 15/15 tasks completed. Added `sprint_created` column with idempotent migration. Fixed `getAgedDebt()` query. Added `isSprintActive()` helper to paths.js. Moved TaskCompleted to SubagentStop. New debt items D14 (SubagentStop noise) and D15 (age calc depends on session sprint names).

- Phase 1: Added `sprint_created` column to schema.sql + idempotent ALTER TABLE migration in index.ts. Updated DebtItem interface and addDebtItem().
- Phase 2: Rewrote `getAgedDebt()` with subquery counting distinct sprints from sessions table. NULL sprint_created items conservatively included.
- Phase 3: Added `isSprintActive()` to paths.js. Refactored drift-detector.js and session-check.js. Wired aged debt warnings into session-start.js.
- Phase 4: Confirmed TaskCompleted is non-standard. Moved task-complete.js to SubagentStop. Removed phantom event from hooks.json.

### Sprint 3: Version & count synchronization across all manifests -- COMPLETED

**Source findings**: 01-version-desync-workflow-yaml.md, 04-hook-count-mismatch.md, 06-plugin-manifests-partial-sync.md
**Priority**: Medium -- integrity issues, no runtime breakage
**Actual phases**: 3 (exceeded estimate of 2 due to phantom plugin directory discovery)
**Result**: 13/13 tasks completed. Synced WORKFLOW.yaml to 2.8.0. Updated all "12 hooks" to "10 hooks" across 4 files. Discovered .claude-plugin/ and .cursor-plugin/ do not exist -- removed all references, consolidated in marketplace.json. Created check-sync.js (10 automated validation checks). New debt item D16 (check-sync not wired into CI).

- Phase 1: Fixed WORKFLOW.yaml version and removed TaskCompleted from hooks list. Updated hook counts in CLAUDE.md, README.md, marketplace.json.
- Phase 2: Removed phantom .claude-plugin/.cursor-plugin references from CLAUDE.md and README.md. Updated RULE-004. Verified marketplace.json alignment.
- Phase 3: Created scripts/check-sync.js with 10 validation checks (version parity, hook count, allowlist, marketplace counts). All checks pass.

### Sprint 4: Harden hook scripts: debug mode, atomic writes, validation -- COMPLETED

**Source findings**: 11-silent-failure-pattern.md, 12-missing-validation-active-session.md
**Priority**: Medium -- robustness improvements
**Actual phases**: 3 (matched estimate)
**Result**: 17/17 tasks completed. Added debugLog(), writeJsonAtomic(), readActiveSession() to paths.js (now 15 exports). Refactored all silent catch blocks across 8 scripts. All .active-session writes now atomic. Validated reader with field checks and corruption recovery.

- Phase 1: Added debugLog() to paths.js. Replaced all silent catch blocks in 8 scripts (drift-detector, rule-checker, post-edit-check, learn-capture, task-complete, quality-gate, session-start, paths.js itself).
- Phase 2: Added writeJsonAtomic() to paths.js. Replaced all fs.writeFileSync for .active-session in 4 scripts (session-start, quality-gate, learn-capture, task-complete).
- Phase 3: Added readActiveSession() with JSON validation (sessionId + project required). Refactored findActiveProject() to use validated reader.

### Sprint 5: Cleanup: debugger skill gap, old directory, docs alignment

**Source findings**: 05-debugger-agent-missing-skill.md, 08-residual-old-storage-path.md
**Priority**: Low -- cosmetic and documentation
**Estimated phases**: 2

- Phase 1: Remove `.agents/kyro/` empty directory. Add `skills: []` to debugger.md frontmatter or create minimal `kyro-debugger` skill.
- Phase 2: Update CLAUDE.md architecture section to note the debugger exception. Review docs/ for any stale references.

---

## Dependency Map

```
Sprint 1 (path fix)
  |
  +--- Sprint 2 (debt-aging)
  |
  +--- Sprint 4 (hardening)

Sprint 3 (sync) -- independent
Sprint 5 (cleanup) -- independent
```

Sprints 3 and 5 can run in parallel with Sprint 1-2 if desired.
