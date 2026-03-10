---
title: "Re-entry Prompts: kyro-workflow self-audit"
date: "2026-03-10"
updated: "2026-03-10"
project: "kyro-workflow"
agents:
  - "claude-opus-4-6"
---

# Re-entry Prompts — kyro-workflow self-audit

## Quick Reference

| Sprint | File | Status |
|--------|------|--------|
| 1 | `sprints/SPRINT-01-critical-hook-fixes.md` | completed |
| 2 | (not yet generated) | pending |
| 3 | (not yet generated) | pending |
| 4 | (not yet generated) | pending |
| 5 | (not yet generated) | pending |

---

## Scenario 1: Generate First Sprint

_N/A -- Sprint 1 already completed._

---

## Scenario 2: Generate Sprint 2

Use to generate Sprint 2 (debt-aging feature + DB query fix):

> I'm continuing the **kyro-workflow self-audit** project. Sprint 1 is complete.
>
> Please read these files in order:
> 1. `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/README.md`
> 2. `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/ROADMAP.md`
> 3. `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/sprints/SPRINT-01-critical-hook-fixes.md` (retro + recommendations + debt table)
> 4. `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/findings/03-ghost-hook-debt-item-aged.md`
> 5. `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/findings/07-getAgedDebt-unused-parameter.md`
> 6. `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/findings/09-no-task-hook-in-claude-code.md`
>
> Then generate Sprint 2 using `/kyro-workflow:sprint generate`.
> Sprint 2 focuses on implementing the missing debt-aging feature and fixing the DB query.

---

## Scenario 3: Execute Current Sprint

Use when a sprint has been generated but not yet executed:

> I'm working on the **kyro-workflow self-audit** project.
>
> Please read the latest sprint file in:
> `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/sprints/`
>
> Then execute it using `/kyro-workflow:sprint execute`.

---

## Scenario 4: Check Status

Use any time for a progress report:

> Show me the status of the **kyro-workflow self-audit** project.
>
> Read: `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/README.md`
>
> Then run `/kyro-workflow:status`.

---

Last updated: 2026-03-10
