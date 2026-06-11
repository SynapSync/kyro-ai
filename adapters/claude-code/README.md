# Claude Code Adapter

Claude Code is the only **native plugin adapter** shipped with Kyro. The adapter lives in `.claude-plugin/` at the package root — do not duplicate it here.

## Install

```bash
/plugin marketplace add SynapSync/kyro-workflow
/plugin install kyro-workflow@kyro-workflow
```

## What the Adapter Registers

- Slash commands: `/kyro-workflow:forge`, `/kyro-workflow:status`, `/kyro-workflow:wrap-up`
- Orchestrator agent with `sprint-forge` skill
- PostToolUse hook → `scripts/hooks/post-edit-hook.js`

## Recommended config.json for Claude Code

```json
"harness": {
  "id": "claude-code",
  "capabilities": {
    "slash_commands": true,
    "subagents": true,
    "post_edit_hooks": true,
    "project_memory": true
  },
  "enforcement": "hooks"
}
```

The portable core (`agents/`, `skills/`, `scripts/`) is identical to other harnesses. Claude-specific behavior is limited to `.claude-plugin/`.

See [agent-adapters.md](../../docs/agent-adapters.md#claude-code-adapter).
