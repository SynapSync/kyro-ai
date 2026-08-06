---
description: Generate a copy-paste prompt for resuming Kyro work in a fresh context
argument-hint: [scope or task notes]
---

# Kyro Task Context

Read `${CLAUDE_PLUGIN_ROOT}/commands/task-context.md` and follow it exactly.

When that router references `skills/...`, resolve the path under
`${CLAUDE_PLUGIN_ROOT}/internal/skills/...`. These internal assets are implementation
details and must not be presented as separate user commands.
