# Kilo Code Adapter

Kilo Code can use Kyro through project context and manual prompts. Kyro does not ship a verified native Kilo Code plugin — compatibility comes from portable markdown files.

## Setup

```bash
mkdir -p .skills .agents .agents/sprint-forge

cp -r kyro-workflow/skills/sprint-forge .skills/
cp -r kyro-workflow/skills/qa-review .skills/
cp kyro-workflow/agents/orchestrator.md .agents/
```

Copy `onboarding-prompt.txt` from this directory into your Kilo Code session or project instructions.

## config.json

```json
"harness": {
  "id": "kilo-code",
  "capabilities": {
    "slash_commands": false,
    "subagents": false,
    "post_edit_hooks": false,
    "project_memory": false
  },
  "enforcement": "manual"
}
```

## Deterministic Checks

```bash
npm run check:post-edit
npm run check:pre-commit
```

See [HOW-TO-USE-KILO-CODE.md](../../docs/HOW-TO-USE-KILO-CODE.md) for full flows.
