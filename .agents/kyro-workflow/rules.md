# Kyro — Learned Rules

## Hook Scripts

- [RULE-001] All hook scripts must import path resolution from `scripts/lib/paths.js` -- never construct `.agents/kyro-workflow/` paths inline (2026-03-10)
- [RULE-002] After renaming or moving storage paths, verify ALL hook scripts were updated by running `grep -r` for the old path across `scripts/` (2026-03-10)
- [RULE-003] The sprint file frontmatter uses `status: "active"` not `status: "in-progress"` -- any hook that checks sprint status must match the template format (2026-03-10)

## Error Handling

- [RULE-009] Never use empty catch blocks in hook scripts -- always call `debugLog()` from paths.js so errors are visible when KYRO_DEBUG=1 (2026-03-10)
- [RULE-010] Always use `writeJsonAtomic()` from paths.js when writing to .active-session -- never use raw fs.writeFileSync (2026-03-10)
- [RULE-011] Always use `readActiveSession()` from paths.js when reading .active-session -- it validates required fields and handles corruption gracefully (2026-03-10)

## Database & Schema

- [RULE-005] When adding columns to existing tables, always include an idempotent ALTER TABLE migration with try/catch in index.ts -- CREATE TABLE IF NOT EXISTS does not add new columns (2026-03-10)
- [RULE-006] hooks.json must only contain standard Claude Code hook events: SessionStart, PreToolUse, PostToolUse, PostToolUseFailure, PreCompact, Stop, SessionEnd, UserPromptSubmit, SubagentStart, SubagentStop -- no custom/aspirational events (2026-03-10)

## Agents

- [RULE-012] Every agent definition must include a `skills:` field in its frontmatter -- use `skills: []` if it intentionally has no skill (2026-03-10)
- [RULE-013] Agent descriptions must only reference real Claude Code hook events (see RULE-006 for the allowlist) -- never use aspirational or invented event names (2026-03-10)

## Version Management

- [RULE-004] When bumping version, update ALL of: package.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json, WORKFLOW.yaml -- then run `node scripts/check-sync.js` to verify (2026-03-10, updated 2026-03-12)
- [RULE-007] When modifying hooks.json (adding/removing events), also update the hooks list in WORKFLOW.yaml to match -- check-sync.js validates this (2026-03-10)
- [RULE-008] Plugin metadata lives in .claude-plugin/ directory (plugin.json, marketplace.json, settings.json). The root marketplace.json no longer exists (2026-03-10, updated 2026-03-12)
