---
name: ad3c-cycle
description: >
  Per-task implementation micro-cycle: Analyze -- Develop -- Certify -- Correct -- Close.
  Use when executing individual tasks within a sprint, feature, or any code change.
license: Apache-2.0
metadata:
  author: synapsync
  version: "1.0"
  scope: [root]
  auto_invoke: "when implementing a task, executing code changes, or completing a work item within a sprint or feature"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# AD3C Cycle — Per-Task Implementation Micro-Cycle

Micro-cycle for executing individual implementation tasks. Every task goes through five steps before it is considered complete: **Analyze → Develop → Certify → Correct → Close**.

```
Sprint / Feature (macro-cycle)
└── Task execution (repeat for each task)
    └── AD3C (micro-cycle per task)
        ├── 1. ANALYZE   — understand what to change
        ├── 2. DEVELOP   — write the code
        ├── 3. CERTIFY   — run QA: lint, typecheck, tests
        ├── 4. CORRECT   — if QA failed, fix and re-certify
        └── 5. CLOSE     — checkpoint + commit
```

## When to use this cycle

Use AD3C for every implementation task that touches 2+ files or involves a design decision. The cycle is designed for:
- Feature implementation within a sprint
- Bug fixes that require code changes
- Refactors with risk of regression
- Any change where "it compiles" is not sufficient evidence of correctness

## 1. ANALYZE

Before writing any code:

- List the exact files the task will touch
- Identify implicit design decisions (new dependencies, new patterns, or extensions of existing ones)
- If analysis reveals the task plan is wrong, return to planning — do not implement on a broken plan

**Output**: A checklist of files and decisions, recorded in the task tracker or sprint document.

## 2. DEVELOP

One coherent intention per task:

- Each task produces a single atomic change
- If development reveals work outside the task scope: record it as technical debt, move on. Do not expand this task
- Use existing project patterns. Do not introduce new ones without justification

## 3. CERTIFY

Mandatory quality gate. Run all relevant checks on the changed code:

| File type | Check |
|-----------|-------|
| TypeScript / JavaScript | Typecheck (`tsc --noEmit`), linter on changed files |
| Python | Typecheck (`mypy` or `pyright`), linter (`ruff`, `flake8`) |
| Go | `go vet`, `go build ./...` |
| Rust | `cargo check`, `clippy` |
| Shell scripts | `bash -n`, `shellcheck` |
| JSON / YAML | Schema validation |
| General | Unit tests for changed code |

Record concrete evidence — the actual command output, not "seems fine".

## 4. CORRECT

If CERTIFY failed, do not close:

- Fix the specific QA failure
- Re-run CERTIFY
- Repeat until it passes, or until you recognize the plan was wrong and return to planning

**Escalation**: If the correction loop exceeds 3 iterations, mark the task as blocked `[!]` and continue to the next task. The block needs a separate planning session.

## 5. CLOSE

Checkpoint and move to the next task:

- Mark the task as completed in the task tracker or sprint document
- Update any shared state files (summary, index, progress)
- If the task produced a committable change: commit with a descriptive message
- If the task was research or analysis only: no commit, just checkpoint

## When to relax the cycle

| Situation | Action |
|-----------|--------|
| 1 file, 1 line change | ANALYZE and DEVELOP collapse. Start from CERTIFY |
| Mechanical refactor (rename, move) | Quick ANALYZE, mechanical DEVELOP, CERTIFY + CLOSE |
| Exploration / spike | No meaningful CERTIFY. Mark as `[~]`, checkpoint without commit |
| CERTIFY takes more than 30 seconds | Run the fastest meaningful check. Commit — the full build runs in CI |
| Task touches 5+ files | Split it into smaller tasks first. If unsplittable, checkpoint per file |

## Evidence format

Record cycle evidence inline in the task tracker:

- Clean pass: `[x] task-name (AD3C: A+D+CERT+CLOSE)`
- Corrected: `[x] task-name (AD3C: A+D+CERT×2+CORR×2+CLOSE)`
- Blocked: `[!] task-name (AD3C: loop exceeded — blocked)`
- Returned to plan: `[>] task-name (AD3C: plan wrong — returned to planning)`

## Design rationale

- **ANALYZE before DEVELOP** catches wrong plans before code is written — the cheapest time to catch a mistake
- **CERTIFY before CLOSE** prevents leaving broken code, even temporarily
- **CORRECT loops** force you to fix or escalate before shipping
- **Evidence format** makes task progress auditable without replaying agent memory
