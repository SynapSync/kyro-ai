# Kyro Harness Adapters

Kyro's portable core lives in `agents/`, `skills/`, `commands/`, `scripts/`, and `config.json`. This directory contains **optional copy-and-customize templates** for specific host platforms.

## Harness Matrix

| Platform | Setup | Slash commands | Hooks | Subagents | Doc |
|----------|-------|----------------|-------|-----------|-----|
| Generic | Copy core files + `generic/` snippet | Manual intents | Manual `npm run check:*` | Set `harness.capabilities.subagents: true` if supported | [agent-adapters.md](../docs/agent-adapters.md) |
| Cursor | Copy core + `cursor/kyro-workflow.mdc` rule | Manual intents | Optional `cursor/hooks.example.json` | Host-dependent | [HOW-TO-USE-CURSOR.md](../docs/HOW-TO-USE-CURSOR.md) |
| Codex | Copy core files | Host-dependent | Manual | Host-dependent | [HOW-TO-USE-CODEX.md](../docs/HOW-TO-USE-CODEX.md) |
| OpenCode | Copy core + `@file` references | Manual intents | Manual | Host-dependent | [HOW-TO-USE-OPENCODE.md](../docs/HOW-TO-USE-OPENCODE.md) |
| Kilo Code | Copy core + `kilo-code/` prompts | Manual intents | Manual | Host-dependent | [HOW-TO-USE-KILO-CODE.md](../docs/HOW-TO-USE-KILO-CODE.md) |
| Claude Code | `/plugin install` | Native `/kyro-workflow:*` | PostToolUse via `.claude-plugin/` | Native subagents | [claude-code/README.md](claude-code/README.md) |
| Any LLM API | Load markdown into system prompt | N/A | Your pipeline runs scripts | Your runtime | [programmatic-usage.md](../docs/programmatic-usage.md) |

## config.json Harness Section

Set capabilities to match your host:

```json
"harness": {
  "id": "cursor",
  "capabilities": {
    "slash_commands": false,
    "subagents": true,
    "post_edit_hooks": false,
    "project_memory": false
  },
  "enforcement": "manual"
}
```

- `enforcement: "manual"` — agent runs `npm run check:post-edit` after edits (default, works everywhere)
- `enforcement: "hooks"` — platform runs scans (Claude Code adapter, optional Cursor hooks)

## Environment Variables

| Variable | Purpose | Legacy alias |
|----------|---------|--------------|
| `KYRO_PROJECT_DIR` | Consumer project root | `CLAUDE_PROJECT_DIR` |
| `KYRO_PACKAGE_ROOT` | Installed Kyro package root | `CLAUDE_PLUGIN_ROOT` |
