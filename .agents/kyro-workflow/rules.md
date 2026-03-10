# Kyro — Learned Rules

## Hook Scripts

- [RULE-001] All hook scripts must import path resolution from `scripts/lib/paths.js` -- never construct `.agents/kyro-workflow/` paths inline (2026-03-10)
- [RULE-002] After renaming or moving storage paths, verify ALL hook scripts were updated by running `grep -r` for the old path across `scripts/` (2026-03-10)
- [RULE-003] The sprint file frontmatter uses `status: "active"` not `status: "in-progress"` -- any hook that checks sprint status must match the template format (2026-03-10)

## Database & Schema

- [RULE-005] When adding columns to existing tables, always include an idempotent ALTER TABLE migration with try/catch in index.ts -- CREATE TABLE IF NOT EXISTS does not add new columns (2026-03-10)
- [RULE-006] hooks.json must only contain standard Claude Code hook events: SessionStart, PreToolUse, PostToolUse, PostToolUseFailure, PreCompact, Stop, SessionEnd, UserPromptSubmit, SubagentStart, SubagentStop -- no custom/aspirational events (2026-03-10)

## Version Management

- [RULE-004] When bumping version, update ALL of: package.json, marketplace.json, WORKFLOW.yaml -- then run `node scripts/check-sync.js` to verify (2026-03-10, updated 2026-03-10)
- [RULE-007] When modifying hooks.json (adding/removing events), also update the hooks list in WORKFLOW.yaml to match -- check-sync.js validates this (2026-03-10)
- [RULE-008] Do not reference .claude-plugin/ or .cursor-plugin/ directories -- they do not exist. Plugin metadata lives in marketplace.json (2026-03-10)
