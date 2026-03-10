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
| 2 | `sprints/SPRINT-02-debt-aging-and-hook-audit.md` | completed |
| 3 | `sprints/SPRINT-03-version-sync-manifests.md` | completed |
| 4 | `sprints/SPRINT-04-hook-hardening.md` | completed |
| 5 | (not yet generated) | pending |

---

## Scenario 1: Generate First Sprint

_N/A -- Sprint 1 already completed._

---

## Scenario 2: Generate Sprint 5

Use to generate Sprint 5 (cleanup + docs alignment):

> I'm continuing the **kyro-workflow self-audit** project. Sprints 1-4 are complete.
>
> Please read these files in order:
> 1. `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/README.md`
> 2. `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/ROADMAP.md`
> 3. `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/sprints/SPRINT-04-hook-hardening.md` (retro + recommendations + debt table)
> 4. `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/findings/05-debugger-agent-missing-skill.md`
> 5. `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/findings/08-residual-old-storage-path.md`
>
> Then generate Sprint 5 using `/kyro-workflow:sprint generate`.
> Sprint 5 focuses on cleanup: debugger skill gap, residual old directory, docs alignment.

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
