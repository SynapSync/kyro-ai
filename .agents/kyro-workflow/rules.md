# Kyro — Learned Rules

## Hook Scripts

- [RULE-001] All hook scripts must import path resolution from `scripts/lib/paths.js` -- never construct `.agents/kyro-workflow/` paths inline (2026-03-10)
- [RULE-002] After renaming or moving storage paths, verify ALL hook scripts were updated by running `grep -r` for the old path across `scripts/` (2026-03-10)
- [RULE-003] The sprint file frontmatter uses `status: "active"` not `status: "in-progress"` -- any hook that checks sprint status must match the template format (2026-03-10)

## Version Management

- [RULE-004] When bumping version, update ALL of: package.json, .claude-plugin/plugin.json, .cursor-plugin/plugin.json, WORKFLOW.yaml (2026-03-10)
