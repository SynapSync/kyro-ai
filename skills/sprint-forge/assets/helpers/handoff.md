---
name: kyro-handoff
description: >
  Enriched session handoff with mental context — active hypotheses, pending decisions,
  identified blockers, and recommended next action. Goes beyond file-based re-entry prompts.
---

# Sprint Handoff — Enriched Context Transfer

## Purpose

Generates a handoff document that captures not just file state but **mental context** — the hypotheses, decisions, and reasoning that a new session needs to continue effectively.

## Handoff Structure

### 1. Sprint State

```text
## Sprint State
- Active sprint: Sprint 3 (in progress)
- Tasks completed: 5/8
- Current task: T2.3 — "Implement rate limiting middleware"
- Phase: 2 of 3
- Last checkpoint: Phase 2 complete
```

### 2. Mental Context

#### Active Hypotheses

Ideas being investigated but not yet confirmed:

```text
### Active Hypotheses
- "The performance issue in /api/users is likely an N+1 query at line 47 of userService.ts"
- "The auth module may have a race condition under concurrent login attempts"
- "The memory spike during CSV export correlates with unbounded stream buffering"
```

#### Pending Decisions

Choices that need to be made before proceeding:

```text
### Pending Decisions
- Redis vs in-memory cache for session storage (waiting for load test results)
- Migrate to new payments API now or defer to Sprint 5 (cost-benefit unclear)
- Monorepo restructure: packages/ or apps/ pattern?
```

#### Identified Blockers

Things that are preventing progress:

```text
### Identified Blockers
- Infra team hasn't provisioned staging environment (ETA unknown)
- Payments API documentation is outdated (v2 docs reference v1 endpoints)
- CI pipeline intermittent failures (flaky test in auth.spec.ts:142)
```

### 3. Recommended Next Action

The single most important thing to do when resuming:

```text
### Next Action
1. Check if infra provisioned staging (ask in #infra channel)
2. If yes → run integration test suite against staging
3. If no → continue with non-blocked tasks: T3.1 (UI polish), T3.2 (error messages)
```

### 4. Corrections & Rules This Session

```text
### Corrections Applied
- User corrected: "Always use parameterized queries, never string concatenation"
  → Saved as RULE-012

### Rules Triggered
- RULE-005: Added 20% buffer to DB migration estimate (Sprint 3, T1.2)
```

### 5. Files Context

```text
### Key Files
- src/middleware/rate-limit.ts — work in progress, half-implemented
- src/services/userService.ts:47 — suspected N+1 query
- tests/auth.spec.ts:142 — flaky test causing CI failures
```

## Generation

When generating a handoff:
1. Read current sprint file for task state
2. Review conversation for hypotheses and decisions
3. Check git status for uncommitted work
4. Check rules applied/proposed this session
5. Write to `{output_kyro_dir}/handoffs/[date]-sprint-[N].md`
6. Update re-entry prompts with handoff reference

## Difference from Re-entry Prompts

| Aspect | Re-entry Prompts | Handoff |
|--------|-----------------|---------|
| Focus | File paths and sprint state | Mental context and reasoning |
| When | After INIT and each sprint | Any time during execution |
| For whom | Any agent, any session | Specifically the next session |
| Content | What to read | What to think about |
