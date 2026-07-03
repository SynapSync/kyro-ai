# Trace events

Kyro trace is an append-only, per-scope audit trail for diagnosing why workflow state changed. It is **not** a source of truth and is never used for routing, gates, or command decisions.

Trace files live at:

```text
.agents/kyro/scopes/{scope}/trace/events.ndjson
```

Each line is one JSON event. The file is written best-effort: trace failures never fail the command that emitted the event.

## Trace vs. sprint ledger

`trace/events.ndjson` and `sprint.json.ledger[]` are different contracts:

- `sprint.json.ledger[]` is the durable sprint-close record and points to zero-loss archive snapshots.
- `trace/events.ndjson` is diagnostic audit data for humans and post-hoc tooling.

Do not call the trace a ledger in code or docs. Do not read it to decide what Kyro should do next.

## Event catalog

All events include this envelope:

```json
{ "v": 1, "ts": "2026-01-01T00:00:00.000Z", "scope": "demo", "type": "..." }
```

| Type | Meaning | Key fields |
| --- | --- | --- |
| `route_selected` | A context-pack route was resolved. | `nextAction`, `packMode`, `budgetClass`, `reasoningTier` |
| `tool_command_run` | A mutating CLI command or MCP tool applied changes. | `surface`, `command`, `args` |
| `validation_result` | Analyze or doctor artifact validation completed. | `source`, `blocking`, `findingCount`, `codes` |
| `gate_approved` | A gate/review passed. | `gate`, `taskId` |
| `retry_count` | A retry round was recorded. | `round`, `limit`, `blocked` |
| `blocked_reason` | A scope/task became blocked. | `reason`, `code` |
| `close_snapshot` | `close-sprint` wrote a zero-loss snapshot and passed post-write validation. | `sprintN`, `snapshotId`, `outcome` |

Payloads are bounded: long strings are truncated, arrays are capped, args are scalar-only, and newlines are sanitized.

## Commands

Read trace events:

```bash
kyro trace --kyro-scope auth-refactor
kyro trace --kyro-scope auth-refactor --json
kyro trace --kyro-scope auth-refactor --tail 20
kyro trace --kyro-scope auth-refactor --type close_snapshot
```

Clear a trace file:

```bash
kyro trace --clear auth-refactor
```

`--clear` requires an explicit scope because it is destructive.

Include a trace summary in doctor output:

```bash
kyro doctor --trace
kyro doctor --trace --kyro-scope auth-refactor
```

The trace summary is informational and does not add blocking exit-code behavior.

## Environment switches

Disable trace writes entirely:

```bash
KYRO_TRACE=0 kyro close-sprint --kyro-scope auth-refactor --yes
```

Debug swallowed trace write failures to stderr:

```bash
KYRO_TRACE_DEBUG=1 kyro close-sprint --kyro-scope auth-refactor --yes
```

Debug output never goes to stdout, preserving MCP stdio purity.

## Invariants

- `emitTraceEvent` is the only trace writer.
- Trace writes are append-only and best-effort.
- Trace failures never throw, exit, or block the real command.
- MCP stdout remains JSON-RPC only.
- `readTrace` is allowed only in `kyro trace` and `doctor --trace` surfaces.
- Routing, context-pack decisions, analysis, and close decisions never read trace files.
