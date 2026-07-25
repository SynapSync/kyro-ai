# Orchestrator–Minion L0 protocol

L0 is an **opt-in execution protocol** for the Kyro forge. It does not change the default single-agent workflow, add CLI flags, or spawn a multi-agent runtime.

## What L0 is

| Aspect | L0 behavior |
|--------|-------------|
| Default | Single orchestrator executes tasks (unchanged) |
| Opt-in | User or orchestrator delegates **one task** to a minion worker |
| Unit of work | **Task** (`handoff.nextTaskId`) — not phase, sprint, or scope |
| Phase UX | "Run the phase with minions" = orchestrator **loops** tasks; no minion owns the phase |
| State | `sprint.json` stays monotheistic — **orchestrator + Kyro CLI** write workflow state |

Kyro already has one agent (`orchestrator`). Skills and modes are instruction files, not spawned subagents. L0 describes **how** the orchestrator may delegate to a host worker (Task, subagent, etc.) when available.

## Write matrix

| Actor | May | Must not |
|-------|-----|----------|
| Orchestrator | Brief, spawn/skip worker, interpret status, CLI, handoff | Give SoT ownership to a minion |
| Minion | Edit product code, run validation, return status/findings | Mutate `sprint.json` / project layers; self-approve review |
| Kyro CLI | `record-evidence`, `review`, `plan`, `close-sprint`, … | — |

## Contracts (summary)

**Brief** — built from `kyro context-pack --kyro-scope <scope> --task <id>`. Includes task identity, files, acceptance criteria, conventions, validation expectations, and explicit prohibitions on workflow-state mutation.

**Status** (execute minion) — final JSON checkpoint with `status` (`in_progress` | `blocked` | `done`), `summary`, `filesChanged`, `validation`, `blockers`. Orchestrator maps `done`+valid validation → `record-evidence`; `blocked` → do not advance handoff casually.

**Findings** (checker minion) — structured findings only; `kyro review` owns the verdict.

**Fallback** — if the host cannot spawn subagents, execute/review fall back to the existing single-agent path without failing.

## Where it lives in the repo

| Surface | Path |
|---------|------|
| Execute protocol | `skills/sprint-forge/assets/modes/execute-task.md` |
| Review protocol | `skills/sprint-forge/assets/modes/review-task.md` |
| Manual eval checklist | `docs/evals.md` (L0 section) |
| Design analysis | `.agents/analysis/0001-2026-07-24-orchestrator-minion-kyro/` (local, gitignored) |

## Out of scope (L0)

- L1 project/scope flags or `minions/*` helpers
- L2 host-specific Task/worktree adapters
- L3 scheduler / blackboard / first-class multi-agent runtime
- New CLI commands or schema changes for status JSON
- Parallel task execution or worktree isolation

## Related docs

- [architecture.md](architecture.md) — Command → Agent → Skill; skills are not subagents
- [maker-checker.md](maker-checker.md) — checker separation and CLI evidence/review
- [context-management.md](context-management.md) — `context-pack` and task packs
