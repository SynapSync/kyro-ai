# Agent-Computer Interface (ACI)

Kyro's tools are designed for agents, not only humans. This page documents the contract every
surface (CLI and MCP) upholds: uniform errors, output verbosity, actionable result summaries, and
consistent parameter names.

## Error contract

Every error a command or MCP tool raises carries a typed `code` and, where a fix exists, a `remedy`.
The CLI prints `ERROR` / `Code` / `Remedy`; MCP returns the same envelope as
`{ code, message, remedy? }` in `structuredContent` with `isError: true`.

| Code | Meaning |
|---|---|
| `SCOPE_NOT_FOUND` | The requested scope has no artifacts. |
| `INVALID_JSON` | `sprint.json` is not valid JSON. |
| `INVALID_SPRINT_SHAPE` | `sprint.json` does not match the v4 schema. |
| `SNAPSHOT_EXISTS` | A close snapshot already exists (double close). |
| `CONFIRMATION_REQUIRED` | A guarded mutation needs `--yes` / `confirm: true`. |
| `POLICY_BLOCKED` | The portable guardrail policy blocked the operation. |
| `CHECKER_FAILED` | The deterministic maker/checker refused a pass verdict. |
| `SELF_REVIEW_BLOCKED` | `requireSeparateChecker` blocked a self-review. |
| `BLOCKING_FINDINGS` | Analyze reported CRITICAL/HIGH findings. |
| `INVALID_INPUT` | A required argument is missing or malformed. |
| `UNKNOWN_COMMAND` | Unknown top-level command. |
| `UNKNOWN_SUBCOMMAND` | Unknown subcommand (`scope`, `mcp`). |
| `UNKNOWN_TOOL` | Unknown MCP tool name. |
| `NO_ACTIVE_SPRINT` | The scope has no active sprint to act on. |
| `TASK_NOT_FOUND` | The referenced task id does not exist. |
| `INTERNAL` | Unexpected internal failure. |

`check:mcp` forbids plain `throw new Error(...)` anywhere in `src/cli/commands` or `src/cli/app.ts`.

## Verbosity

`context-pack` accepts a verbosity level controlling output **depth** (orthogonal to `--json`, which
controls serialization format).

- `detailed` (default): the full pack — long-form task context, budget guidance, and all scope
  conventions.
- `concise`: trims long-form advisory prose (task `context`, budget guidance) and returns only
  testing/architecture/process conventions. The structured routing and task fields an agent needs to
  act are always present.

```bash
kyro context-pack --kyro-scope auth --task T1.2 --verbosity concise --json
```

MCP: `context_pack { "verbosity": "concise" }`.

## Result summaries (MCP)

Every MCP tool result puts a one-line, actionable summary in `content[].text` and the full machine
payload in `structuredContent`. Examples:

```
analyze_scope: 3 finding(s) (1 CRITICAL, 1 HIGH) — BLOCKING. Next: A001.
close_sprint: plan ready (12 ops). Re-call with confirm:true.
review_task: pass, next=execute_task.
context_pack: scope=auth (executing), next=execute_task T1.3, ~420 tokens.
```

## Parameter naming map

Repo merge settings are global, so Kyro keeps names explicit and consistent across surfaces. New
names are additive — existing flags keep working.

| Concept | CLI | MCP |
|---|---|---|
| scope id | `--kyro-scope` | `scope` |
| task id | `--task` | `task_id` |
| confirm mutation | `--yes` / `--confirm` | `confirm` |
| output depth | `--verbosity` | `verbosity` |

> Note: CLI `--scope` is the **install** scope (workspace/global), which is why the Kyro artifact
> scope keeps the explicit `--kyro-scope` name.

## MCP tool surface

Nine tools, each with typed input schema, usage guidance in its description, and MCP annotations
(`readOnlyHint` / `destructiveHint` / `idempotentHint`):

| Tool | Kind | Notes |
|---|---|---|
| `context_pack` | read | Supports `verbosity`. |
| `doctor_artifacts` | read | Artifact shape checks. |
| `analyze_scope` | read | Semantic findings. |
| `scope_list` | read | List scopes. |
| `scope_inspect` | read | One scope's checks. |
| `close_sprint` | mutate | Two-phase; needs `confirm`. |
| `repair_scope` | mutate | Two-phase; needs `confirm`. |
| `review_task` | mutate | Maker/checker; two-phase; refuses an incoherent pass. |
| `trace_tail` | read | Recent trace events (observability only). |

Mutating tools follow the two-phase contract: without `confirm: true` they return the plan and write
nothing.
