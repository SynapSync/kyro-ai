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
| 1 | Fix critical hook path bugs & create shared path utility | 02, 10 | bugfix + refactor | pending |
| 2 | Implement missing debt-aging feature & fix DB query | 03, 07, 09 | feature + bugfix | pending |
| 3 | Version & count synchronization across all manifests | 01, 04, 06 | sync-fix | pending |
| 4 | Harden hook scripts: debug mode, atomic writes, validation | 11, 12 | quality | pending |
| 5 | Cleanup: debugger skill gap, old directory, docs alignment | 05, 08 | cleanup | pending |

---

## Sprint Details

### Sprint 1: Fix critical hook path bugs & create shared path utility

**Source findings**: 02-hook-scripts-wrong-sprint-path.md, 10-no-shared-path-resolution.md
**Priority**: Critical -- hooks are silently broken today
**Estimated phases**: 3

- Phase 1: Create `scripts/lib/paths.js` shared module with `getKyroDir()`, `getSprintsDir(project)`, `findActiveProject()`, `getActiveSessionPath()`
- Phase 2: Refactor all 11 hook scripts to use the shared module, fixing sprint paths from `.agents/kyro-workflow/sprints/` to `.agents/kyro-workflow/sprint-forge/{project}/sprints/`
- Phase 3: Fix `context-warning.js` RE-ENTRY-PROMPTS.md path resolution. Test all scripts with a mock project structure.

### Sprint 2: Implement missing debt-aging feature & fix DB query

**Source findings**: 03-ghost-hook-debt-item-aged.md, 07-getAgedDebt-unused-parameter.md, 09-no-task-hook-in-claude-code.md
**Priority**: High -- promised features that do not work
**Estimated phases**: 4
**Dependencies**: Sprint 1 (shared path module needed)

- Phase 1: Add `sprint_created` column to `schema.sql` debt_items table. Update `addDebtItem()` in store.ts.
- Phase 2: Fix `getAgedDebt()` to actually filter by sprint age using the new column.
- Phase 3: Implement debt-aging check in `session-start.js` (using shared path module from Sprint 1). Log aged items to stderr.
- Phase 4: Audit `TaskCompleted` hook -- determine if Claude Code fires it. If not, move task-completion logic to the orchestrator agent's task execution protocol.

### Sprint 3: Version & count synchronization across all manifests

**Source findings**: 01-version-desync-workflow-yaml.md, 04-hook-count-mismatch.md, 06-plugin-manifests-partial-sync.md
**Priority**: Medium -- integrity issues, no runtime breakage
**Estimated phases**: 2

- Phase 1: Fix WORKFLOW.yaml version to 2.8.0. Standardize hook count across all references (decide on "11 events" or "15 entries"). Fix description mismatches between plugin manifests.
- Phase 2: Create a `scripts/check-sync.js` script that validates version, hook count, description, and manifest parity. Add to CI or pre-commit.

### Sprint 4: Harden hook scripts: debug mode, atomic writes, validation

**Source findings**: 11-silent-failure-pattern.md, 12-missing-validation-active-session.md
**Priority**: Medium -- robustness improvements
**Estimated phases**: 3
**Dependencies**: Sprint 1 (shared path module)

- Phase 1: Add `KYRO_DEBUG` env var support to shared module. When set, log hook errors to stderr. Refactor all silent catch blocks.
- Phase 2: Replace .active-session JSON file read-modify-write with atomic write pattern (write to .active-session.tmp, then rename).
- Phase 3: Add JSON schema validation for .active-session reads. Add error recovery for corrupted files.

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
