# AD3C Cycle — Per-Task Implementation Micro-Cycle

Micro-cycle for executing individual tasks within a sprint phase. Each task goes through five steps before closing: **Analyze → Develop → Certify → Correct → Close**.

```
forge (sprint macro-cycle)
├── INIT
├── PLAN
├── EXECUTE (task by task)
│   └── AD3C (micro-cycle per task)             ← THIS
│       ├── 1. ANALYZE
│       ├── 2. DEVELOP
│       ├── 3. CERTIFY
│       ├── 4. CORRECT
│       └── 5. CLOSE
├── REVIEW
└── CLOSE
```

## 1. ANALYZE

Before touching any code:

- List the exact files the task will touch
- Identify implicit design decisions (new deps? new patterns? existing patterns to extend?)
- If analysis reveals the task plan is wrong, return to `plan-sprint.md` — do not implement on a broken plan
- Output: a checklist of files + decisions, written to the sprint markdown

## 2. DEVELOP

One coherent intention per task:

- Each task produces one atomic change
- If development reveals work outside the task scope: convert it to technical debt and proceed. Do not expand this task
- Use existing project patterns. Do not introduce new ones without justification

## 3. CERTIFY

Mandatory. Not optional. Run QA on everything the task touched:

- **TypeScript**: `tsc --noEmit` or equivalent typecheck
- **Lint**: project linter on changed files
- **Tests**: tests related to the changed code
- **Shell scripts** (if any): `bash -n` + `shellcheck`
- **JSON/YAML** (if any): validate format

Record concrete evidence — the actual command output, not "seems fine".

## 4. CORRECT

If CERTIFY failed, do not close:

- Fix the specific QA failure
- Re-run CERTIFY
- Repeat until it passes, or until you recognize the plan was wrong (return to PLAN)

## 5. CLOSE

Checkpoint and continue:

- Mark the task as completed in the sprint file
- Write state.json, update summary files
- If the task produced a committable change: commit with a descriptive message
- If the task was research/analysis only: no commit, just checkpoint

## When to relax the cycle

| Situation | Action |
|-----------|--------|
| 1 file, 1 line change | ANALYZE and DEVELOP collapse. Go straight to CERTIFY |
| Mechanical refactor (rename, move) | Quick ANALYZE, mechanical DEVELOP, CERTIFY + CLOSE |
| Exploration / spike | No real CERTIFY. Mark as `[~]` research, checkpoint without commit |
| CERTIFY takes >30s | Run the fastest meaningful check. Commit, the full build runs in CI |
| Task touches 5+ files | Split the task first. If unsplittable, checkpoint per file |

## Evidence format

Record cycle evidence inline in the sprint markdown:

- Pass: `[x] task-name (AD3C: A+D+CERT+CLOSE)`
- Corrected: `[x] task-name (AD3C: A+D+CERT×2+CORR×2+CLOSE)`
- Returned to plan: `[>] task-name (AD3C: PLAN→task analysis→returned to PLAN)`

## Design rationale

- **ANALYZE before DEVELOP** catches wrong plans before code is written — the cheapest time to catch a mistake
- **CERTIFY before CLOSE** prevents leaving broken code in the sprint, even temporarily
- **CORRECT loops** force you to fix or escalate before shipping
- **Evidence format** makes sprint files auditable without replaying agent memory
