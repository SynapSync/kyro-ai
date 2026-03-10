---
title: "Sprint 4 — Harden hook scripts: debug mode, atomic writes, validation"
date: "2026-03-10"
updated: "2026-03-10"
project: "kyro-workflow"
type: "sprint-plan"
status: "completed"
version: "1.0"
sprint: 4
progress: 100
previous_doc: "[[SPRINT-03-version-sync-manifests]]"
next_doc: "[[SPRINT-05-cleanup]]"
parent_doc: "[[ROADMAP]]"
agents:
  - "claude-opus-4-6"
tags:
  - "kyro-workflow"
  - "sprint-plan"
  - "sprint-4"
changelog:
  - version: "1.0"
    date: "2026-03-10"
    changes: ["Sprint generated and implemented"]
related:
  - "[[ROADMAP]]"
  - "[[SPRINT-03-version-sync-manifests]]"
  - "[[11-silent-failure-pattern]]"
  - "[[12-missing-validation-active-session]]"
---

# Sprint 4 — Harden hook scripts: debug mode, atomic writes, validation

> Source: `findings/11-silent-failure-pattern.md`, `findings/12-missing-validation-active-session.md`
> Previous Sprint: SPRINT-03-version-sync-manifests (completed)
> Type: quality
> Execution Date: 2026-03-10
> Executed By: claude-opus-4-6

---

## Disposition of Sprint 3 Recommendations

| # | Recommendation | Disposition | Sprint 4 Phase |
|---|---------------|-------------|-----------------|
| R1 | Wire check-sync.js into postbuild or pretest | **Deferred** — out of scope for hardening sprint, logged as D16 | -- |
| R2 | Silent catch blocks should log when KYRO_DEBUG is set | **Accepted** — core of Phase 1 | Phase 1 |
| R3 | Atomic write: write .tmp then rename | **Accepted** — core of Phase 2 | Phase 2 |
| R4 | Batch D14/D15 if time permits | **Deferred** — keeping scope tight | -- |

---

## Phases

### Phase 1 — KYRO_DEBUG env var + catch block refactor

**Objective**: Add a `debugLog(msg)` function to paths.js that logs to stderr only when `KYRO_DEBUG=1`. Replace all silent catch blocks across hook scripts.

**Tasks**:

- [x] **T1.1**: Add `debugLog(msg)` to `scripts/lib/paths.js`. Logs `[Kyro:debug] {msg}` to stderr when `process.env.KYRO_DEBUG === '1'`. Export it.
  - Files: `scripts/lib/paths.js`

- [x] **T1.2**: Replace silent catch in `scripts/drift-detector.js` with `debugLog`.
  - Files: `scripts/drift-detector.js`

- [x] **T1.3**: Replace silent catch in `scripts/rule-checker.js` with `debugLog`.
  - Files: `scripts/rule-checker.js`

- [x] **T1.4**: Replace silent catch in `scripts/post-edit-check.js` with `debugLog`.
  - Files: `scripts/post-edit-check.js`

- [x] **T1.5**: Replace silent catches in `scripts/learn-capture.js` (3 catch blocks) with `debugLog`.
  - Files: `scripts/learn-capture.js`

- [x] **T1.6**: Replace silent catch in `scripts/task-complete.js` (inner catch for session file) with `debugLog`.
  - Files: `scripts/task-complete.js`

- [x] **T1.7**: Replace silent catch in `scripts/quality-gate.js` (session file catch) with `debugLog`.
  - Files: `scripts/quality-gate.js`

- [x] **T1.8**: Replace silent catch in `scripts/session-start.js` (config read catch) with `debugLog`.
  - Files: `scripts/session-start.js`

- [x] **T1.9**: Update `findActiveProject()` catch in `scripts/lib/paths.js` to use `debugLog`.
  - Files: `scripts/lib/paths.js`

### Phase 2 — Atomic writes for .active-session

**Objective**: Add `writeJsonAtomic(filePath, data)` to paths.js. Replace all direct `fs.writeFileSync` calls for .active-session with atomic writes.

**Tasks**:

- [x] **T2.1**: Add `writeJsonAtomic(filePath, data)` to `scripts/lib/paths.js`. Writes to `filePath + '.tmp'`, then renames to `filePath`. Export it.
  - Files: `scripts/lib/paths.js`

- [x] **T2.2**: Replace `fs.writeFileSync(sessionFile, ...)` in `scripts/session-start.js` with `writeJsonAtomic`.
  - Files: `scripts/session-start.js`

- [x] **T2.3**: Replace `fs.writeFileSync(sessionFile, ...)` in `scripts/quality-gate.js` with `writeJsonAtomic`.
  - Files: `scripts/quality-gate.js`

- [x] **T2.4**: Replace `fs.writeFileSync(sessionFile, ...)` in `scripts/learn-capture.js` with `writeJsonAtomic`.
  - Files: `scripts/learn-capture.js`

- [x] **T2.5**: Replace `fs.writeFileSync(sessionFile, ...)` in `scripts/task-complete.js` with `writeJsonAtomic`.
  - Files: `scripts/task-complete.js`

### Phase 3 — Validated reader for .active-session

**Objective**: Add `readActiveSession()` to paths.js that validates the JSON structure. If corrupt, log warning and return null.

**Tasks**:

- [x] **T3.1**: Add `readActiveSession()` to `scripts/lib/paths.js`. Reads .active-session, parses JSON, validates required fields (sessionId, project). Returns parsed data or null if missing/corrupt. Uses `debugLog` for errors.
  - Files: `scripts/lib/paths.js`

- [x] **T3.2**: Update `findActiveProject()` in paths.js to use `readActiveSession()` instead of raw JSON.parse.
  - Files: `scripts/lib/paths.js`

- [x] **T3.3**: Run `npm run build` and `node scripts/test-hooks.js` to verify no regressions.
  - Files: (build/test output)

---

## Accumulated Technical Debt

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1-5 | (resolved in Sprints 1-2) | -- | -- | resolved | -- |
| 6-8 | (resolved in Sprint 3) | -- | -- | resolved | -- |
| 9 | Silent catch blocks in all hook scripts hide errors | INIT finding 11 | Sprint 4 | resolved | Sprint 4 |
| 10 | .active-session file has race condition | INIT finding 12 | Sprint 4 | resolved | Sprint 4 |
| 11 | Debugger agent has no skill declaration | INIT finding 05 | Sprint 5 | open | -- |
| 12 | Residual empty `.agents/kyro/` directory | INIT finding 08 | Sprint 5 | open | -- |
| 13 | (resolved in Sprint 2) | -- | -- | resolved | -- |
| 14 | task-complete.js fires on all SubagentStop events | Sprint 2 retro | backlog | open | -- |
| 15 | getAgedDebt() depends on session sprint names | Sprint 2 retro | backlog | open | -- |
| 16 | check-sync.js not wired into CI/build | Sprint 3 retro | backlog | open | -- |

---

## Definition of Done

- [x] `debugLog()` function added to paths.js
- [x] All silent catch blocks replaced with debugLog calls
- [x] `writeJsonAtomic()` function added to paths.js
- [x] All .active-session writes use atomic pattern
- [x] `readActiveSession()` function added to paths.js with validation
- [x] `findActiveProject()` uses validated reader
- [x] `npm run build` passes
- [x] `node scripts/test-hooks.js` passes

---

## Retro

### What Went Well

- Three new shared functions (debugLog, writeJsonAtomic, readActiveSession) added to paths.js -- the module now has 15 exports and is the single entry point for all hook infrastructure
- Every silent catch across 8 scripts replaced in one pass with no regressions (10/10 hook tests)
- Atomic write pattern is simple (write .tmp + rename) and required zero changes to the read side

### What Didn't Go Well

- Nothing blocked progress

### Surprises / Unexpected Findings

- post-edit-check.js had no import from paths.js at all before this sprint -- it was the only script not using the shared module. Now fixed.
- The one remaining `catch (_)` in findProjectDirs (fs.statSync) is legitimate -- not a silent error swallow, just a skip-on-failure pattern for directory listing.

### New Technical Debt Detected

- No new debt items this sprint.

---

## Recommendations for Sprint 5

1. The debugger agent (finding #05) references skills but has none declared -- either add a minimal kyro-debugger skill or document the exception in CLAUDE.md.
2. For the residual `.agents/kyro/` cleanup (finding #08), check if any user installations might still have data there before removing. Consider adding a one-time migration notice.
3. After Sprint 5 completes the roadmap, consider a final "audit complete" summary sprint or commit that captures the full audit outcome.
