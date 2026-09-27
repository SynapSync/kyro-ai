# Portable guardrails

Kyro guardrails classify dangerous operations and enforce the decision inside Kyro's own CLI/MCP write paths. They are portable because the decision lives in core code, not in a host-specific hook.

## Important honesty note

The CLI-managed Claude adapter does not install host hooks. Kyro's portable guards apply to Kyro CLI/MCP operations, not to arbitrary Claude Bash commands. The retired plugin's unbounded-search and sprint-close `PreToolUse` interceptions are no longer distributed; users must bound search output and use the CLI's managed write verbs. This is an explicit reduction in host-level interception, not a claim of equivalent coverage.

## Policy file

Kyro ships a safe default policy. A workspace may add `.agents/kyro/policy.json`:

```json
{
  "policyVersion": 1,
  "operations": {
    "close_sprint": { "level": "tool_owned" },
    "repair_scope": { "level": "confirm" },
    "scope_set_active": { "level": "confirm" },
    "clear_active_sprint": { "level": "blocked" },
    "delete_archive": { "level": "blocked" }
  },
  "allow": []
}
```

Levels:

- `tool_owned`: the operation must go through the Kyro tool/core write path.
- `confirm`: the operation requires explicit confirmation (`--yes` for CLI, `confirm: true` for MCP tools).
- `blocked`: the operation is refused before writes.

## Fail-safe merge

Workspace policy cannot silently weaken the default. The effective level is the stricter of default and override. `allow[]` can only downgrade a `blocked` operation to `confirm`; it cannot remove confirmation or tool ownership.

Malformed policy is ignored for enforcement and reported by `kyro analyze` as a finding.

## Enforcement tiers

`kyro doctor --adapters` reports guardrail tiers per adapter:

- `enforced`: Kyro can block in-process through tool ownership, blocked policy, or MCP confirmation.
- `advisory`: the adapter only has a text/CLI path where an agent could pass `--yes` unattended.

Advisory means the agent can still do it — the policy documents intent, but the surface cannot prove human approval.

## MCP registration

Adapters with MCP capability register Kyro's MCP server during install. For Codex, Kyro writes a TOML-safe managed block to `~/.codex/config.toml`:

```toml
[mcp_servers.kyro]
command = "kyro"
args = ["mcp", "serve"]
```

Adapters without MCP capability do not receive MCP config.

## Trace

Policy denials emit `blocked_reason`; approvals emit `gate_approved`. Trace is best-effort and never a source of truth.

## Active task definitions

`plan --update-active` uses the existing CLI writer boundary, not direct editor access. It requires
an open scope, its current unclosed sprint, a read-only preview digest and explicit confirmation.
The apply re-reads under the state-writer lease and atomically replaces the live sprint together
with affected approval invalidation. Historical artifacts and parent lifecycle fields are not
editable input. No Claude-specific editor hook is installed; the CLI protects only its own managed write path.

## Error codes

- `CONFIRMATION_REQUIRED`: operation needs explicit approval.
- `POLICY_BLOCKED`: operation is blocked by effective policy.

## Maker/checker policy extension

`maker_checker.requireSeparateChecker` can require a separate checker actor for passing task verdicts. See [maker-checker.md](maker-checker.md).
