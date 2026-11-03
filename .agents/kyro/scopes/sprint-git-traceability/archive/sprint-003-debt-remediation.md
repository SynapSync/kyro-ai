---
title: 'sprint-git-traceability — Sprint 3: Debt remediation: active-plan statuses, root lock ignore, Windows CI evidence'
date: '2026-11-02'
scope: 'sprint-git-traceability'
sprint: 3
slug: 'debt-remediation'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 3: Debt remediation: active-plan statuses, root lock ignore, Windows CI evidence

> Closed: 2026-11-02
> Outcome: shipped

## Objective

Remove the open debt found in Sprints 1-2: active-plan updates leave coherent phase statuses, the root state-writer lock is ignored by git per ADR-0002, and the Windows CI evidence for the new checks is recorded.

## Definition of Done

- All tasks done with CLI-recorded evidence and a passing verdict.
- Proportional close validation passes; escalation applies if install-plan or state paths change.
- debt-1, debt-2, and debt-7 are resolved through their tasks.

## Phases

### P1 — Debt fixes

> Fix debt-1 and debt-2 with regression coverage.

#### T3.1: Keep phase statuses coherent after plan --update-active (debt-1)

**Status**: done

**Description**: kyro plan --update-active left phase statuses incoherent (P1 'active', P2/P3 'blocked' while every task was pending), producing kyro analyze coherence findings until kyro repair normalized them. Make the active-plan update derive phase and sprint statuses exactly as repair/analyze expect, for every task-state combination it can produce.

**Evidence**:
- Summary: Implemented by Sol 6.1. Root cause: update-active passed execution states (ready/blocked) to derivePhaseStatus, so a phase with a ready pending task became 'active' and one waiting on dependencies 'blocked', while repair/analyze derive persisted statuses from task statuses only. active-plan.ts now uses the same derivation as repair/analyze.
- Validation: npm run check:active-plan: pass — 'ok all-pending update uses repair/analyze status derivation', 'ok mixed done/pending/ready update uses repair/analyze status derivation' (also checks analyze coherence and that a following repair changes nothing); '18 active-edit, freshness and immutable-history groups passed' (reported by Sol 6.1, outside sandbox)
- Validation: npm run build: pass (reported by Sol 6.1)
- Validation: Live reproduction in this scope (orchestrator): update-active on Sprint 3 produced P1 active / P2 blocked with all tasks pending before the fix
- Files changed: `src/cli/core/active-plan.ts`, `scripts/check-active-plan.mjs`

**Verdict**: pass

---
#### T3.2: Ignore the root state-writer lock via the local git exclude file (debt-2, ADR-0002)

**Status**: done

**Description**: Implement ADR-0002: install and sync idempotently add '/.kyro-state-writer.lock*' (prefixed with the workspace path when the Kyro workspace is a repository subdirectory) to the repository's local exclude file resolved with git rev-parse --git-path info/exclude; never write the root .gitignore or any tracked file; outside git write nothing. kyro doctor WARNs with the exact remedy when the root lock path is not ignored.

**Evidence**:
- Summary: Remediation of Astra findings by Sol 6.1 (T3.1 unchanged). git-trackability.ts now validates the exclude destination against the git dir and common dir, rejects symlinks in info/ and exclude, opens without following links and verifies descriptor identity before writing (M1); rejects workspace prefixes with control characters or line separators and omits unsafe exact-line remedies (M2); distinguishes confirmed non-repository from failed git discovery and WARNs with a PATH remedy (m1); bounds git subprocesses to 10 s. Original ADR-0002 behavior retained: idempotent local exclude entry from install/sync, prefixed for subdirectory workspaces, nothing outside git, doctor WARN/PASS.
- Validation: npm run check:git-trackability: pass — 'ok M1 symlinked exclude: tracked target byte-identical; install/sync nonfatal; doctor WARN'; 'ok M2 line-separator workspace paths: exclude byte-identical; unrelated secret.txt visible; unsupported workspace path WARN'; 'ok m1 unavailable Git: discovery WARN with PATH remedy; no writes'; 'ok Git calls use 10 s timeout; timed-out discovery WARNs and stays nonfatal'; original root/nested/worktree/outside-git/doctor cases pass (reported by Sol 6.1, outside sandbox)
- Validation: npm run build, check:install-rehydrate, check:update: pass (reported by Sol 6.1)
- Files changed: `src/cli/core/git-trackability.ts`, `src/cli/commands/install.ts`, `src/cli/commands/doctor.ts`, `scripts/check-git-trackability.mjs`
- Notes: Native Windows execution not verified locally; the portable identity fallback was simulated. Windows CI runs on the next push.

**Verdict**: pass — [object Object]

---
### P2 — Release evidence

> Record the Windows CI evidence for the Sprint 2 checks.

#### T3.3: Record Windows CI evidence for the new checks (debt-7)

**Status**: done

**Description**: Confirm on PR #154 that the Windows CI job ran check:sprint-git-traceability and check:sprint-close-commit successfully on every Node version in the matrix, and record the run URLs and results as evidence. If any job fails, materialize the fix as a new task delegated to Sol 6.1.

**Evidence**:
- Summary: Windows CI evidence for PR #154 at commit 449d8b4: all three Windows jobs (Node 18.x, 20.x, 22.x) succeeded, and in each the steps 'Verify sprint git traceability' and 'Verify sprint close commit' succeeded. No source change.
- Validation: gh run view 41541928577 --json jobs: Node 18.x success https://github.com/SynapSync/kyro-ai/actions/runs/41541928577/job/125607996468; Node 20.x success https://github.com/SynapSync/kyro-ai/actions/runs/41541928577/job/125607996598; Node 22.x success https://github.com/SynapSync/kyro-ai/actions/runs/41541928577/job/125607996509 — both sprint steps success in each
- Files changed: `.github/workflows/ci.yml`
- Notes: Covers Sprint 2 checks including E3's PowerShell manual-command case. Sprint 3 changes are not yet pushed; their Windows run happens on the next push.

**Verdict**: pass — [object Object]

---

## Unfinished work

_None — every task is done with a passing verdict._

## Learnings

- Writes into git metadata must refuse redirected targets (symlinks, hard links, replacement races) and line-oriented formats must reject separators in interpolated paths.
- Delegating implementation to Sol 6.1 and QA to Astra kept the orchestrator on Kyro state; Astra's adversarial probes caught security defects the implementer's tests missed.

## Resolved Debt

- **debt-1**: plan --update-active leaves phase statuses incoherent (active/blocked with all-pending tasks)
- **debt-2**: Root-level .kyro-state-writer.lock/ is not gitignored
- **debt-3**: Forward compatibility: checkpoints with close.git fail verification on runtimes older than this release
- **debt-4**: Structured git range and warnings in CLI --json close data and MCP results, with an MCP assertion
- **debt-5**: Resumed close without frozen close.git reports a present-time reason
- **debt-6**: plan sprint-mode --json envelope lacks data.outcome
- **debt-7**: Confirm Windows CI runs check:sprint-close-commit and check:sprint-git-traceability green before release

## Recommendations for Sprint 4

- After pushing, confirm the PR #154 Windows jobs for the Sprint 3 changes and resolve debt-8.
- Decide on scope completion and the 6.5.0 release; then update kyro-qa-assist to v1.1 in skills-registry.
