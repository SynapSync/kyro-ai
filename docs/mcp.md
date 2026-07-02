# MCP Typed Tool Surface

Kyro exposes a tools-only MCP server over stdio:

```bash
kyro mcp serve
kyro mcp tools
```

The CLI remains the deterministic core. MCP is a protocol shell over the same core functions used by the CLI.

## Protocol

- Transport: stdio, newline-delimited JSON-RPC 2.0 messages.
- Served protocol version: `2025-06-18`.
- Capabilities: `{ "tools": {} }` only.
- Methods: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`.
- `stdout` is protocol-only. Diagnostics must go to `stderr`.

## Tools

| Tool | Mutation | Purpose |
|---|---:|---|
| `context_pack` | No | Build minimal routing/task context for a scope. |
| `doctor_artifacts` | No | Validate Kyro artifact shape and archive integrity. |
| `analyze_scope` | No | Run semantic checks for clarity, coverage, deps, debt, and principles. |
| `scope_list` | No | List known scopes and active status. |
| `scope_inspect` | No | Inspect one scope with artifact checks. |
| `close_sprint` | Yes | Build/apply the zero-loss sprint close plan. |
| `repair_scope` | Yes | Build/apply sprint.json normalization. |

Mutating tools use a two-phase protocol. Without `confirm: true`, they return a dry-run plan and write nothing. With `confirm: true`, Kyro rebuilds the plan from disk, applies it, and revalidates `sprint.json`.

## Error envelope

Tool-level failures return `isError: true` with structured content:

```json
{ "code": "SCOPE_NOT_FOUND", "message": "...", "remedy": "..." }
```

Reserved codes: `SCOPE_NOT_FOUND`, `INVALID_JSON`, `INVALID_SPRINT_SHAPE`, `SNAPSHOT_EXISTS`, `CONFIRMATION_REQUIRED`, `POLICY_BLOCKED`, `BLOCKING_FINDINGS`, `INVALID_INPUT`, `INTERNAL`.

## Host registration examples

Claude Code:

```bash
claude mcp add kyro -- kyro mcp serve
```

OpenCode (`opencode.json`):

```json
{
  "mcp": {
    "kyro": {
      "command": "kyro",
      "args": ["mcp", "serve"]
    }
  }
}
```

Codex (`config.toml`):

```toml
[mcp_servers.kyro]
command = "kyro"
args = ["mcp", "serve"]
```

Cursor (`mcp.json`):

```json
{
  "mcpServers": {
    "kyro": {
      "command": "kyro",
      "args": ["mcp", "serve"]
    }
  }
}
```
