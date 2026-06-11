# Memory Adapter

Kyro keeps `.agents/sprint-forge/rules.md` as the canonical learned-rule store. Optional memory integrations are derived indexes only.

## Default Portable Mode

Use the local rules memory script:

```bash
npm run kyro:rules-memory -- sync
npm run kyro:rules-memory -- query "task context"
```

This creates `.agents/sprint-forge/rules.index.json` from `[LEARN]` entries when a rules file exists.

## Optional MCP Mode

Set `config.json`:

```json
{
  "memory": {
    "mcp_enabled": true
  }
}
```

When MCP memory is available, agents may sync the derived index into the server, but `rules.md` remains the only source of truth. If MCP is unavailable or unauthenticated, continue with local query/full-file fallback.

## Conflict Policy

1. Manual edits to `rules.md` win.
2. Derived indexes are regenerated from `rules.md`.
3. MCP observations should include source hash and provenance.
4. Never delete or rewrite `rules.md` from MCP memory.
