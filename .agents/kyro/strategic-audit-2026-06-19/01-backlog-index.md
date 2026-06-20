# Strategic Audit Backlog Index

This backlog turns each audit theme into executable technical work. Start with P0 reproducibility before investing in context, memory, retrieval, or observability. A harness that cannot reproduce its own runtime is not ready for smarter automation.

## Recommended execution order

| Order | Backlog | Why first | Priority |
|-------|---------|-----------|----------|
| 1 | `backlogs/00-p0-reproducibility-and-ci.md` | Fix runtime/source trust before any other work | P0 |
| 2 | `backlogs/06-reliability-validation.md` | Establish schemas and validation contracts | P1 |
| 3 | `backlogs/01-token-cost-optimization.md` | Make context cheaper and measurable | P1 |
| 4 | `backlogs/02-context-memory-architecture.md` | Structure what agents need to remember and retrieve | P1 |
| 5 | `backlogs/03-markdown-documentation-contract.md` | Prevent docs/artifacts from drifting | P1 |
| 6 | `backlogs/04-agent-harness-hooks-commands.md` | Add deterministic hooks and commands | P1 |
| 7 | `backlogs/07-metrics-observability.md` | Make agent execution inspectable | P2 |
| 8 | `backlogs/05-retrieval-vector-assessment.md` | Evaluate retrieval only after local indexes exist | P2/P3 |
| 9 | `backlogs/08-recommended-architecture.md` | Consolidate architecture after individual slices land | P2 |
| 10 | `backlogs/09-official-documentation-platform.md` | Publish official docs after product contracts stabilize | P2 |

## Backlog sizing guidance

| Size | Meaning |
|------|---------|
| S | One file or script; can be done in a short focused change |
| M | Multiple files with tests/fixtures; good single PR |
| L | Cross-cutting behavior; likely needs proposal/design/tasks first |

## Work policy

- Keep every backlog item independently reviewable.
- Add fixtures before changing behavior when possible.
- Prefer deterministic CLI checks over prompt instructions.
- Keep generated technical artifacts in English.
- Do not add vector retrieval until local text/metadata indexing has measurable gaps.
- Do not publish official docs until CLI behavior, artifact contracts, and adapter docs are stable enough to avoid documenting churn.
