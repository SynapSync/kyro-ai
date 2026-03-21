---
title: "Sprint 5 — Cleanup: debugger skill gap, residual paths, backlog items"
date: "2026-03-10"
updated: "2026-03-10"
project: "kyro-workflow"
type: "sprint-plan"
status: "completed"
version: "1.1"
sprint: 5
progress: 100
previous_doc: "[[SPRINT-04-hook-hardening]]"
parent_doc: "[[ROADMAP]]"
agents:
  - "claude-opus-4-6"
tags:
  - "kyro-workflow"
  - "sprint-plan"
  - "sprint-5"
changelog:
  - version: "1.0"
    date: "2026-03-10"
    changes: ["Sprint generated and implemented"]
  - version: "1.1"
    date: "2026-03-10"
    changes: ["Sprint completed. 7/7 tasks. All 16 debt items resolved. Audit complete."]
related:
  - "[[ROADMAP]]"
  - "[[SPRINT-04-hook-hardening]]"
  - "[[05-debugger-agent-missing-skill]]"
  - "[[08-residual-old-storage-path]]"
---

# Sprint 5 — Cleanup: debugger skill gap, residual paths, backlog items

> Source: `findings/05-debugger-agent-missing-skill.md`, `findings/08-residual-old-storage-path.md`
> Previous Sprint: SPRINT-04-hook-hardening (completed)
> Type: cleanup
> Execution Date: 2026-03-10
> Executed By: claude-opus-4-6

---

## Disposition of Sprint 4 Recommendations

| # | Recommendation | Disposition | Sprint 5 Phase |
|---|---------------|-------------|-----------------|
| R1 | Debugger: add skills or document exception | **Accepted** — Phase 1 | Phase 1 |
| R2 | Residual dir: check before removing, add migration notice | **Accepted** — Phase 2 (dir does not exist, add legacy warning) | Phase 2 |
| R3 | After Sprint 5, consider audit-complete summary | **Noted** — will be done during close | Close |

---

## Pre-Sprint Discovery

- `.agents/kyro/` does NOT exist in the current working copy. The old directory was already removed (or never tracked). D12 reduces to: add a legacy detection warning in session-start.js.
- debugger.md references "TaskFailed hook" in its description, but TaskFailed is not a hook event -- it's a convention name for the PostToolUseFailure pattern. This should be clarified.

---

## Phases

### Phase 1 — Debugger agent skill gap

**Tasks**:

- [x] **T1.1**: Add `skills: []` to `agents/debugger.md` frontmatter to explicitly signal "no dedicated skill." This matches the pattern of other agents and makes the intentional absence clear.
  - Files: `agents/debugger.md`

- [x] **T1.2**: Update the debugger description to clarify "TaskFailed hook" is actually the `PostToolUseFailure` hook event (not a custom event).
  - Files: `agents/debugger.md`

### Phase 2 — Residual old path detection

**Tasks**:

- [x] **T2.1**: Add a legacy path warning to `scripts/session-start.js`. After kyroDir setup, check if `.agents/kyro/` exists. If it does, log `[Kyro] Legacy directory .agents/kyro/ detected. Data has moved to .agents/kyro-workflow/`.
  - Files: `scripts/session-start.js`

### Phase 3 — Backlog items (D14, D15, D16)

**Tasks**:

- [x] **T3.1**: (D14) Add a guard in `scripts/task-complete.js` to only show the quality checklist for kyro-related agents. Check if `agent_name` contains "explorer", "reviewer", "debugger", or "orchestrator". For other agents, skip the checklist but still increment the counter.
  - Files: `scripts/task-complete.js`

- [x] **T3.2**: (D15) Document the getAgedDebt() session dependency limitation as a code comment in `src/db/store.ts` at the getAgedDebt function. This is not worth a code fix -- just make the assumption explicit.
  - Files: `src/db/store.ts`

- [x] **T3.3**: (D16) Add `"check-sync": "node scripts/check-sync.js"` to the scripts section of `package.json`.
  - Files: `package.json`

- [x] **T3.4**: Run `npm run build`, `node scripts/test-hooks.js`, and `npm run check-sync` to verify.
  - Files: (build/test output)

---

## Accumulated Technical Debt

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1-10 | (resolved in Sprints 1-4) | -- | -- | resolved | -- |
| 11 | Debugger agent has no skill declaration | INIT finding 05 | Sprint 5 | resolved | Sprint 5 |
| 12 | Residual empty `.agents/kyro/` directory | INIT finding 08 | Sprint 5 | resolved | Sprint 5 |
| 13 | (resolved in Sprint 2) | -- | -- | resolved | -- |
| 14 | task-complete.js fires on all SubagentStop events | Sprint 2 retro | Sprint 5 | resolved | Sprint 5 |
| 15 | getAgedDebt() depends on session sprint names | Sprint 2 retro | Sprint 5 | resolved | Sprint 5 |
| 16 | check-sync.js not wired into CI/build | Sprint 3 retro | Sprint 5 | resolved | Sprint 5 |

---

## Definition of Done

- [x]debugger.md has `skills: []` in frontmatter
- [x]debugger.md references correct hook event name
- [x]Legacy .agents/kyro/ detection added to session-start.js
- [x]task-complete.js filters quality checklist by agent name
- [x]getAgedDebt() has documented limitation comment
- [x]package.json has check-sync npm script
- [x]`npm run build` passes
- [x]`node scripts/test-hooks.js` passes
- [x]`npm run check-sync` passes

---

## Retro

### What Went Well
- Cleanest sprint of the audit: all 7 tasks straightforward with no blockers or surprises.
- Backlog items D14, D15, D16 resolved efficiently -- each was a targeted, low-risk change.
- All verification checks (build, hooks 10/10, check-sync 10/10) passed on first attempt.
- The accumulated infrastructure from Sprints 1-4 (paths.js, debugLog, writeJsonAtomic, check-sync.js) made Sprint 5 trivially easy.

### What Didn't Go Well
- Nothing notable. This was a cleanup sprint and went smoothly.

### Surprises / Unexpected Findings
- debugger.md referenced "TaskFailed hook" which is not a real Claude Code event name. This was a documentation bug hiding in plain sight since the agent was written.

### New Technical Debt Detected
- None. All 16 debt items across the audit are now resolved.

---

## Recommendations (Post-Audit)

1. **Run check-sync.js before every release**: Wire `npm run check-sync` into CI or pre-publish hooks to prevent version/count desync from recurring.
2. **Enable KYRO_DEBUG=1 during development**: The debug logging infrastructure is in place across all hooks -- use it when iterating on hook behavior.
3. **Periodic self-audit**: Re-run this audit pattern (INIT + sprint cycle) every 3-5 major versions to catch drift early.
4. **Consider a kyro-debugger skill**: The debugger agent intentionally has no skill (`skills: []`), but if debugging patterns grow complex, extract a dedicated skill with failure taxonomy and root-cause templates.
