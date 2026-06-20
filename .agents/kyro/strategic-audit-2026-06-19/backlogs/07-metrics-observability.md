# Backlog: Metrics and Observability

Kyro preserves final state, but it does not yet preserve enough execution telemetry to understand how agents spend context, which checks fail, or where routes become expensive.

## Evidence

- `doctor --tokens` reports static token budget checks.
- `scope inspect` and summaries report current state.
- There is no append-only event log for phase start/end, loaded context, checks, retries, or validation outcomes.

## Technical correction

Add lightweight, append-only observability that remains local and git-friendly. Start with JSONL events; aggregate into reports later.

## Tasks

| ID | Priority | Size | Task | Likely files | Acceptance criteria | Validation |
|----|----------|------|------|--------------|---------------------|------------|
| OBS-001 | P2 | M | Define event schema | `docs/events.md`, `src/cli/events/schema.ts` | Event fields include timestamp, scope, phase, action, status, files, token estimate, command, result | Schema tests |
| OBS-002 | P2 | M | Add event writer helper | `src/cli/events/write.ts` | CLI can append JSONL events under scope event path | Unit test with temp workspace |
| OBS-003 | P2 | M | Log validation and repair events | `doctor`, `repair`, `refresh-summaries`, future commands | Key commands append events when scope is known | Fixture event log |
| OBS-004 | P2 | M | Add metrics report command | `src/cli/commands/metrics.ts` | Reports route count, validation failures, stale summaries, estimated token usage | Golden fixture |
| OBS-005 | P2 | S | Add event log docs to context strategy | `docs/context-management.md`, new docs | Agents know event log is evidence, not prompt memory | Link check |

## Metrics to capture

| Metric | Why it matters |
|--------|----------------|
| Context pack estimated tokens | Cost control |
| Files included in context pack | Oversharing detection |
| Validation failures by type | Reliability trend |
| Summary stale warnings | Knowledge contract health |
| Retry/correction count | Agent workflow friction |
| Commands run per task | Execution overhead |
| Changed lines per task | Review workload control |
