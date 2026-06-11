# Memory Adapter

Kyro keeps `.agents/sprint-forge/rules.md` as the canonical learned-rule store. Optional memory integrations are derived indexes only.

## Provider Selection

Set `config.json` → `memory.provider`:

```json
{
  "memory": {
    "provider": "local",
    "rules_canonical": ".agents/sprint-forge/rules.md",
    "derived_index": ".agents/sprint-forge/rules.index.json",
    "max_retrieved_rules": 5
  }
}
```

| Provider | Status | Behavior |
|----------|--------|----------|
| `local` | Supported | Builds and queries `.agents/sprint-forge/rules.index.json` |
| `mcp` | Interface only | Stub until a server-specific adapter is selected |

Legacy `memory.mcp_enabled: true` still resolves to provider `mcp` when `provider` is omitted.

## Default Portable Mode

Use the local rules memory script:

```bash
npm run kyro:rules-memory -- sync
npm run kyro:rules-memory -- query "task context"
```

This creates `.agents/sprint-forge/rules.index.json` from `[LEARN]` entries when a rules file exists.

## Bridge Contract

`scripts/lib/memory-bridge.js` is the provider boundary:

- `sync({ memory, indexPath, content, rules })` — regenerate derived state
- `query({ memory, rules, query, maxRules })` — return ranked matches
- `resolveProvider(memory)` — map config to `local` or `mcp`

`scripts/rules-memory.js` is the CLI entry point and always routes through the bridge.

## Optional MCP Mode

Set:

```json
{
  "memory": {
    "provider": "mcp"
  }
}
```

The MCP provider is a stub in v3.12.0. Agents should continue with local query or full-file fallback until a server-specific adapter lands.

When MCP memory is available in a future release, agents may sync the derived index into the server, but `rules.md` remains the only source of truth. If MCP is unavailable or unauthenticated, continue with local query/full-file fallback.

## Conflict Policy

1. Manual edits to `rules.md` win.
2. Derived indexes are regenerated from `rules.md`.
3. MCP observations should include source hash and provenance.
4. Never delete or rewrite `rules.md` from MCP memory.
