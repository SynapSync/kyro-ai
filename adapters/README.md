# Kyro Harness Adapters

Kyro's portable core lives in `agents/`, `skills/`, `commands/`, `scripts/`, and `config.json`. Install it with:

```bash
npx @synapsync/kyro-workflow init
```

This directory contains **optional post-init templates** for specific host platforms (rules, hooks, onboarding prompts).

## Harness Matrix

| Platform | Setup | Slash commands | Hooks | Subagents | Doc |
|----------|-------|----------------|-------|-----------|-----|
| All | `npx @synapsync/kyro-workflow init` | Manual intents | Manual `npm run check:*` | Config flag | [getting-started.md](../docs/getting-started.md) |
| Cursor | `init --cursor` or `cursor/kyro-workflow.mdc` | Manual intents | Optional `cursor/hooks.example.json` | Host-dependent | [HOW-TO-USE-CURSOR.md](../docs/HOW-TO-USE-CURSOR.md) |
| Codex | `init` | Host-dependent | Manual | Host-dependent | [HOW-TO-USE-CODEX.md](../docs/HOW-TO-USE-CODEX.md) |
| OpenCode | `init` + `@file` references | Manual intents | Manual | Host-dependent | [HOW-TO-USE-OPENCODE.md](../docs/HOW-TO-USE-OPENCODE.md) |
| Kilo Code | `init` + `kilo-code/` prompts | Manual intents | Manual | Host-dependent | [HOW-TO-USE-KILO-CODE.md](../docs/HOW-TO-USE-KILO-CODE.md) |
| Claude Code | `init` or `/plugin install` | Native `/kyro-workflow:*` with plugin | PostToolUse via `.claude-plugin/` | Native subagents | [claude-code/README.md](claude-code/README.md) |
| Any LLM API | `init` + load markdown into system prompt | N/A | Your pipeline runs scripts | Your runtime | [programmatic-usage.md](../docs/programmatic-usage.md) |

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
