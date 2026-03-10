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
| 1 | `sprints/SPRINT-01-critical-hook-fixes.md` | generated |
| 2 | (not yet generated) | pending |
| 3 | (not yet generated) | pending |
| 4 | (not yet generated) | pending |
| 5 | (not yet generated) | pending |

---

## Scenario 1: Generate First Sprint

Use this prompt to start Sprint 1:

> I'm working on the **kyro-workflow self-audit** project. This is a kyro-workflow sprint project.
>
> Please read these files in order:
> 1. `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/README.md`
> 2. `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/ROADMAP.md`
> 3. `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/findings/02-hook-scripts-wrong-sprint-path.md`
> 4. `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/findings/10-no-shared-path-resolution.md`
>
> Then generate Sprint 1 using `/kyro-workflow:sprint generate`.
> Sprint 1 focuses on fixing critical hook path bugs and creating a shared path utility.

---

## Scenario 2: Continue to Next Sprint

Use after completing a sprint to generate the next one:

> I'm continuing the **kyro-workflow self-audit** project.
>
> Please read these files in order:
> 1. `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/README.md`
> 2. `/Users/rperaza/joicodev/owned/synap-sync/kyro-workspace/.agents/kyro-workflow/sprint-forge/kyro-workflow/ROADMAP.md`
> 3. The latest sprint file in `sprints/` directory
>
> Then generate the next sprint using `/kyro-workflow:sprint generate`.

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
