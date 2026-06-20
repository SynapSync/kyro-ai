# Backlog: Recommended Architecture Consolidation

This backlog consolidates the target architecture after the foundational pieces land. Do not start here first; architecture documents should reflect implemented contracts, not wishful diagrams.

## Target architecture

```text
CLI deterministic core
  -> install/sync/uninstall/detect/doctor/repair/scope
  -> context-pack
  -> artifact validate
  -> refresh-summaries
  -> docs index/impact
  -> dist freshness
  -> event logging/metrics

Agent layer
  -> command stubs
  -> summary-first routers
  -> LLM reasoning and implementation
  -> Markdown evidence updates

Artifact layer
  -> Markdown durable truth
  -> JSON derived routing cache
  -> local indexes derived from files
  -> event logs append-only observability
```

## Tasks

| ID | Priority | Size | Task | Likely files | Acceptance criteria | Validation |
|----|----------|------|------|--------------|---------------------|------------|
| ARC-001 | P2 | S | Update architecture diagram after P0/P1 work | `docs/architecture.md`, `docs/architecture.mmd` | Diagram includes CLI context, validation, summaries, indexes, event log | Markdown/link check |
| ARC-002 | P2 | M | Document CLI/agent/artifact boundary | `docs/architecture.md`, `docs/harness-hooks.md` | Clear rule: deterministic work belongs in CLI; judgment belongs in agent | Review checklist |
| ARC-003 | P2 | M | Add runtime contract doc | `docs/runtime-contract.md` | Documents commands, inputs, outputs, source-of-truth rules, failure behavior | Link check |
| ARC-004 | P2 | M | Add adapter contract doc | `docs/agent-adapters.md` | Adapter capabilities, managed files/blocks, projection checks, and limitations are explicit | Adapter fixture validation |
| ARC-005 | P3 | L | Reassess architecture after metrics | future audit doc | Uses metrics to decide if FTS/vector/model routing should advance | Metrics report evidence |

## Anti-patterns to prevent

- Moving creative analysis into deterministic code.
- Moving deterministic validation into prompt prose.
- Duplicating full Markdown content into JSON summaries.
- Adding vector retrieval before indexing and measurement.
- Adding autonomous agents before validation and observability are strong.
