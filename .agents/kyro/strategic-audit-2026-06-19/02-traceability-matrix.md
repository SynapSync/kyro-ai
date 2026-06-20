# Audit Traceability Matrix

Every major audit section maps to one or more backlog items. If a section has no backlog item, it is not actionable enough yet.

| Audit theme | Finding | Backlog file | Task IDs |
|-------------|---------|--------------|----------|
| Reproducibility and CI | `dist/` is stale and adapter checks are not enforced in CI | `00-p0-reproducibility-and-ci.md` | REP-001, REP-002, REP-003, REP-004 |
| Token and cost optimization | Context selection is mostly prompt-driven, not generated | `01-token-cost-optimization.md` | TCO-001, TCO-002, TCO-003, TCO-004, TCO-005 |
| Context and memory architecture | Persistent/temporary/on-demand context is conceptually clear but not fully encoded | `02-context-memory-architecture.md` | CMA-001, CMA-002, CMA-003, CMA-004, CMA-005 |
| Markdown and documentation | Markdown lacks ownership, derivation, and validation metadata | `03-markdown-documentation-contract.md` | MDC-001, MDC-002, MDC-003, MDC-004, MDC-005 |
| Agent harness/hooks/commands | Hooks are recommended but not implemented as deterministic commands | `04-agent-harness-hooks-commands.md` | AHH-001, AHH-002, AHH-003, AHH-004, AHH-005, AHH-006 |
| Vector DB/retrieval | Vector DB is not justified before local indexes/FTS | `05-retrieval-vector-assessment.md` | RET-001, RET-002, RET-003, RET-004 |
| Reliability/validation | Artifact contracts exist in TS but not as reusable schemas | `06-reliability-validation.md` | REL-001, REL-002, REL-003, REL-004, REL-005 |
| Metrics/instrumentation | No append-only execution observability layer | `07-metrics-observability.md` | OBS-001, OBS-002, OBS-003, OBS-004, OBS-005 |
| Recommended architecture | CLI/agent/artifact boundaries should become explicit runtime contracts | `08-recommended-architecture.md` | ARC-001, ARC-002, ARC-003, ARC-004 |
| Official documentation | Public docs should be published only after core contracts stabilize | `09-official-documentation-platform.md` | DOCS-001, DOCS-002, DOCS-003, DOCS-004, DOCS-005, DOCS-006 |

## Definition of traceability complete

- [ ] Each audit finding has at least one backlog task.
- [ ] Each backlog task has acceptance criteria.
- [ ] Each backlog task names likely files or modules.
- [ ] Each backlog task has validation commands or evidence requirements.
- [ ] Each P0/P1 task can be reviewed without reading the whole audit again.
