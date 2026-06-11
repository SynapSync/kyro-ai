# Subagent Parallelism

Use this helper when `config.json` has `parallelism.init_fanout: true` **and** `harness.capabilities.subagents: true`. If subagents are unavailable, use the sequential fallback and produce the same artifacts.

## INIT Fan-Out

During INIT, launch independent read-only exploration tracks:

| Track | Output |
|-------|--------|
| Architecture | `findings/architecture.md` |
| Dependencies | `findings/dependencies.md` |
| Risks | `findings/risks.md` |
| Debt | `findings/debt.md` |

Each subagent must return:

```text
Finding file target:
Severity:
Evidence:
Recommendation:
Open questions:
```

The orchestrator merges findings, deduplicates contradictions, and generates the roadmap from the merged set.

## Isolated QA Review

For review, launch QA with clean context containing only:

- The diff or changed file list.
- Relevant sprint artifact path.
- `state.json` path when available.
- The focused `qa-review` references required for the review type.

The QA subagent returns:

```text
Review Verdict: APPROVE | APPROVE WITH WARNINGS | BLOCK
BLOCKERS:
WARNINGS:
SUGGESTIONS:
Verification Gaps:
```

## Worktree Tasks

Worktree task execution is experimental and disabled by default.

Only parallelize tasks that are explicitly marked independent in the sprint file. If independence is unclear, run sequentially.

Required safeguards:

1. Create one worktree per independent task.
2. Run deterministic checks in each worktree.
3. Merge only after the parent sprint artifact records task completion.
4. On conflict, stop and return to sequential execution.
