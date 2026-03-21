---
title: "Sprint 3 — Version synchronization and manifest alignment"
date: "2026-03-10"
updated: "2026-03-10"
project: "kyro-workflow"
type: "sprint-plan"
status: "completed"
version: "1.0"
sprint: 3
progress: 100
previous_doc: "[[SPRINT-02-debt-aging-and-hook-audit]]"
next_doc: "[[SPRINT-04-harden-hooks]]"
parent_doc: "[[ROADMAP]]"
agents:
  - "claude-opus-4-6"
tags:
  - "kyro-workflow"
  - "sprint-plan"
  - "sprint-3"
changelog:
  - version: "1.0"
    date: "2026-03-10"
    changes: ["Sprint generated"]
related:
  - "[[ROADMAP]]"
  - "[[SPRINT-02-debt-aging-and-hook-audit]]"
  - "[[01-version-desync-workflow-yaml]]"
  - "[[04-hook-count-mismatch]]"
  - "[[06-plugin-manifests-partial-sync]]"
---

# Sprint 3 — Version synchronization and manifest alignment

> Source: `findings/01-version-desync-workflow-yaml.md`, `findings/04-hook-count-mismatch.md`, `findings/06-plugin-manifests-partial-sync.md`
> Previous Sprint: SPRINT-02-debt-aging-and-hook-audit (completed)
> Version Target: 2.8.0 (sync all files to match package.json)
> Type: sync-fix
> Execution Date: 2026-03-10
> Executed By: claude-opus-4-6

---

## Disposition of Sprint 2 Recommendations

| # | Recommendation | Disposition | Sprint 3 Phase |
|---|---------------|-------------|-----------------|
| R1 | Add version string to a single source-of-truth location | **Accepted** — Phase 3 check-sync.js will read version from package.json as the canonical source | Phase 3 |
| R2 | check-sync.js should check for phantom hook events | **Accepted** — Phase 3 will validate hooks.json keys against a standard event allowlist | Phase 3 |
| R3 | Distinguish "hook events" vs "hook entries" in documentation | **Accepted** — Phase 1 will standardize on "10 hook events, 15 hook entries" | Phase 1 |
| R4 | Read hooks.json programmatically for true event count | **Accepted** — Phase 3 check-sync.js will count from hooks.json directly | Phase 3 |

---

## Pre-Sprint Discovery

During Sprint 3 preparation, a critical discovery was made:

**Finding #06 references `.claude-plugin/plugin.json` and `.cursor-plugin/plugin.json` but these directories do not exist.** They are referenced in CLAUDE.md (lines 50-51, 80-83), README.md (lines 154-155), and RULE-004 in rules.md. The actual plugin metadata lives in `marketplace.json`. This changes the scope of Finding #06 from "sync two plugin manifests" to "remove phantom directory references and consolidate metadata in marketplace.json."

Additionally, WORKFLOW.yaml still lists `TaskCompleted` in its hooks section (stale after Sprint 2 removal). This must be fixed.

---

## Phases

### Phase 1 — Fix version and hook count across all files

**Objective**: Synchronize WORKFLOW.yaml version to 2.8.0. Update all hook count references from "12" to the actual count (10 events, 15 entries). Remove TaskCompleted from WORKFLOW.yaml hooks list. Update descriptions for consistency.

**Tasks**:

- [x] **T1.1**: Update `WORKFLOW.yaml` version from `"2.3.0"` to `"2.8.0"` to match package.json.
  - Files: `WORKFLOW.yaml`
  - Evidence: Version changed from "2.3.0" to "2.8.0"
  - Verification: Version string matches package.json

- [x] **T1.2**: Remove `TaskCompleted` from the hooks list in `WORKFLOW.yaml` (it was removed from hooks.json in Sprint 2). The list should now show 10 hook events.
  - Files: `WORKFLOW.yaml`
  - Evidence: TaskCompleted line removed, SubagentStop comment updated to include quality checklist
  - Verification: WORKFLOW.yaml hooks list matches hooks.json keys exactly (10 events)

- [x] **T1.3**: Update `CLAUDE.md` hook count comment from "12 hook definitions" to "10 hook events" (line 36: `hooks.json # 12 hook definitions`).
  - Files: `CLAUDE.md`
  - Evidence: Changed to "10 hook events, 15 hook entries"
  - Verification: Comment reflects actual count

- [x] **T1.4**: Update `README.md` hook count from "12 hooks" to "10 hooks" in the header badge (line 14) and directory tree comment (line 143).
  - Files: `README.md`
  - Evidence: Both locations updated: badge line and directory tree comment
  - Verification: All "12 hooks" references updated

- [x] **T1.5**: Update `marketplace.json` description from "12 hooks" to "10 hooks" (line 14).
  - Files: `marketplace.json`
  - Evidence: Description updated
  - Verification: marketplace.json uses correct count
  - Verification: Description uses correct count

### Phase 2 — Fix phantom plugin directory references and consolidate metadata

**Objective**: Remove references to non-existent `.claude-plugin/` and `.cursor-plugin/` directories. Consolidate plugin metadata in `marketplace.json` as the single source of truth. Update RULE-004 in rules.md.

**Tasks**:

- [x] **T2.1**: Remove the `.claude-plugin/` and `.cursor-plugin/` lines from the directory structure in `CLAUDE.md` (lines 50-51). Update the "Plugin Manifests" section (lines 80-83) to reference `marketplace.json` instead.
  - Files: `CLAUDE.md`
  - Evidence: Replaced phantom dirs with WORKFLOW.yaml. Renamed section to "Plugin Metadata" referencing package.json, marketplace.json, WORKFLOW.yaml.
  - Verification: No references to .claude-plugin or .cursor-plugin directories remain in CLAUDE.md

- [x] **T2.2**: Remove the `.claude-plugin/` and `.cursor-plugin/` lines from the directory structure in `README.md` (lines 154-155). Update any "plugin manifests must be kept in sync" language to reference marketplace.json.
  - Files: `README.md`
  - Evidence: Replaced 2 phantom dir lines with single WORKFLOW.yaml line.
  - Verification: No references to phantom plugin directories remain in README.md

- [x] **T2.3**: Update `RULE-004` in `.agents/kyro-workflow/rules.md` to remove `.claude-plugin/plugin.json` and `.cursor-plugin/plugin.json` references. Replace with `marketplace.json`.
  - Files: `.agents/kyro-workflow/rules.md`
  - Evidence: RULE-004 now reads: "update ALL of: package.json, marketplace.json, WORKFLOW.yaml -- then run node scripts/check-sync.js to verify"
  - Verification: RULE-004 references the correct files

- [x] **T2.4**: Verify `marketplace.json` description matches `package.json` description in intent and key claims (agent count, hook count, command count, skill count). Update marketplace.json if needed.
  - Files: `marketplace.json`
  - Evidence: marketplace.json says "4 agents, 10 hooks, 9 commands, 7 skills" -- all correct. package.json is more generic (no counts). Both aligned in intent.
  - Verification: Descriptions are aligned

### Phase 3 — Create check-sync.js validation script

**Objective**: Create a script that programmatically validates version, hook count, description, and metadata parity across all manifest files. This prevents future desync.

**Tasks**:

- [x] **T3.1**: Create `scripts/check-sync.js` that reads `package.json`, `WORKFLOW.yaml`, `marketplace.json`, and `hooks/hooks.json`. It validates:
  - (a) Version in WORKFLOW.yaml matches package.json
  - (b) Hook event count in WORKFLOW.yaml matches hooks.json key count
  - (c) hooks.json contains only standard Claude Code events (allowlist check)
  - (d) marketplace.json description hook/agent/command/skill counts match reality
  - Exit code 0 if all checks pass, 1 if any fail. Print each check result to stderr.
  - Files: `scripts/check-sync.js` (new)
  - Evidence: Script created with 10 validation checks. Parses WORKFLOW.yaml hooks section, compares against hooks.json, validates allowlist, checks marketplace counts.
  - Verification: Running `node scripts/check-sync.js` exits 0. Non-standard events or version mismatches would cause exit 1.

- [x] **T3.2**: Run `node scripts/check-sync.js` to validate all fixes from Phase 1 and Phase 2 are correct.
  - Files: (script output)
  - Evidence: 10/10 checks passed, exit code 0
  - Verification: All checks pass (exit 0)

- [x] **T3.3**: Run `npm run build` to verify no TypeScript regressions.
  - Files: (build output)
  - Evidence: Build succeeded with 0 errors
  - Verification: Build passes with 0 errors

---

## Emergent Phases

<!-- This section starts EMPTY. It is populated during sprint EXECUTION when new work is discovered. -->

---

## Findings Consolidation

<!-- This section is filled during sprint CLOSE, before the Retro. -->

| # | Finding | Origin Phase | Impact | Action Taken |
|---|---------|-------------|--------|-------------|
| F1 | .claude-plugin/ and .cursor-plugin/ directories do not exist | Pre-sprint discovery | high | Removed all references, consolidated metadata in marketplace.json |
| F2 | WORKFLOW.yaml still listed TaskCompleted after Sprint 2 removal | Phase 1, T1.2 | medium | Removed from hooks list |

---

## Accumulated Technical Debt

<!-- Inherited from Sprint 2 (15 items). Items D6, D7, D8 are targeted by this sprint. -->

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1 | Hook scripts use wrong sprint path | INIT finding 02 | Sprint 1 | resolved | Sprint 1 |
| 2 | No shared path resolution module | INIT finding 10 | Sprint 1 | resolved | Sprint 1 |
| 3 | `DebtItemAged` hook referenced but never implemented | INIT finding 03 | Sprint 2 | resolved | Sprint 2 |
| 4 | `getAgedDebt()` maxSprints parameter ignored in SQL query | INIT finding 07 | Sprint 2 | resolved | Sprint 2 |
| 5 | `TaskCompleted` may not be a standard Claude Code hook event | INIT finding 09 | Sprint 2 | resolved | Sprint 2 |
| 6 | WORKFLOW.yaml version stuck at 2.3.0 (should be 2.8.0) | INIT finding 01 | Sprint 3 | resolved | Sprint 3 |
| 7 | Hook count claims "12" but actual count is 10 events / 15 entries | INIT finding 04 | Sprint 3 | resolved | Sprint 3 |
| 8 | Plugin manifests only partially synchronized | INIT finding 06 | Sprint 3 | resolved | Sprint 3 |
| 9 | Silent catch blocks in all hook scripts hide errors | INIT finding 11 | Sprint 4 | open | -- |
| 10 | .active-session file has race condition (read-modify-write without locking) | INIT finding 12 | Sprint 4 | open | -- |
| 11 | Debugger agent has no skill declaration | INIT finding 05 | Sprint 5 | open | -- |
| 12 | Residual empty `.agents/kyro/` directory from old path scheme | INIT finding 08 | Sprint 5 | open | -- |
| 13 | Sprint status regex duplicated inline in drift-detector.js and session-check.js | Sprint 1 retro | Sprint 2 | resolved | Sprint 2 |
| 14 | task-complete.js fires on all SubagentStop events, not just task-related ones | Sprint 2 retro | backlog | open | -- |
| 15 | getAgedDebt() depends on sessions table having sprint names populated | Sprint 2 retro | backlog | open | -- |

---

## Definition of Done

- [x] WORKFLOW.yaml version matches package.json (2.8.0)
- [x] WORKFLOW.yaml hooks list matches hooks.json (10 events, no TaskCompleted)
- [x] CLAUDE.md hook count updated from "12" to "10"
- [x] README.md hook count updated from "12" to "10"
- [x] marketplace.json description updated with correct hook count
- [x] No references to .claude-plugin/ or .cursor-plugin/ in CLAUDE.md or README.md
- [x] RULE-004 updated to reference marketplace.json instead of phantom plugin dirs
- [x] marketplace.json description aligned with package.json
- [x] `scripts/check-sync.js` created and validates all sync checks
- [x] `node scripts/check-sync.js` exits 0
- [x] `npm run build` passes without errors
- [x] Accumulated debt table updated
- [x] Retro section filled
- [x] Recommendations for Sprint 4 documented
- [x] Re-entry prompts updated

---

## Retro

<!-- Filled during sprint CLOSE. -->

### What Went Well

- All 4 Sprint 2 recommendations absorbed cleanly into the plan
- check-sync.js provides a permanent safety net against future desync -- 10 automated checks
- Cleanest sprint yet: no emergent phases, no blocked tasks, no regressions

### What Didn't Go Well

- Nothing blocked progress

### Surprises / Unexpected Findings

- .claude-plugin/ and .cursor-plugin/ directories referenced extensively in docs but never existed. Finding #06 was based on phantom directories. The actual scope was simpler: remove references and consolidate in marketplace.json.
- WORKFLOW.yaml still listed TaskCompleted despite Sprint 2 removing it from hooks.json -- a reminder that WORKFLOW.yaml is easy to forget during changes.

### New Technical Debt Detected

- D16: WORKFLOW.yaml is not automatically validated during `npm run build` or CI. check-sync.js must be run manually. Consider adding it as a postbuild script or CI step.

---

## Recommendations for Sprint 4

1. When adding KYRO_DEBUG env var support (Sprint 4, Phase 1), consider also wiring check-sync.js into a postbuild or pretest npm script to prevent future desync automatically.
2. The silent catch blocks (D9) should log to stderr when KYRO_DEBUG is set, not when it is unset -- keep default behavior quiet.
3. For the atomic write pattern (D10), use `fs.writeFileSync` to a `.tmp` file then `fs.renameSync` -- this is atomic on POSIX systems.
4. Consider batching D14 (SubagentStop noise) and D15 (age calc dependency) into Sprint 4 if time permits, since they are low-severity.
