---
description: Route the Kyro forge workflow with progressive disclosure
argument-hint: <scope or request>
---

# /kyro:forge — Router

Use this command to continue Kyro work without loading the whole workflow upfront.

## Startup

1. Read `.agents/kyro/kyro.json` if it exists.
2. Resolve the active scope from `$ARGUMENTS`, `activeScope`, or the only directory under `.agents/kyro/scopes/`.
3. For a resolved scope, read `state.json`, `index.json`, and `.agents/kyro/scopes/rules.index.json` if present.
4. Do not read ROADMAP, sprint Markdown, templates, or helper files until the selected route requires them.

## Route

| Condition | Load next |
|-----------|-----------|
| No project state | Create or validate `.agents/kyro/kyro.json`, then continue routing. |
| No scope or no roadmap | `skills/sprint-forge/assets/modes/INIT.md` |
| Roadmap exists and no active sprint | `skills/sprint-forge/assets/modes/plan-sprint.md` |
| Active sprint has pending tasks | `skills/sprint-forge/assets/modes/execute-task.md` |
| Active sprint needs quality validation | `skills/sprint-forge/assets/modes/review-task.md` |
| Sprint/session is ready to close | `skills/sprint-forge/assets/modes/close-sprint.md` |
| State is inconsistent or interrupted | `skills/sprint-forge/assets/modes/recover.md` |

## Rules

- Load only the routed mode plus the helpers named by that mode; never preload sprint/debt/re-entry helpers.
- Enforce orchestrator gates from `agents/orchestrator.md` only at gate moments.
- Follow the Write Policy from the routed mode:
  - task close writes only a minimal append-only event;
  - phase close updates compact routing state only;
  - sprint close materializes Markdown evidence, summaries, re-entry prompts, debt, and rules.
- Do not refresh roadmap, re-entry prompts, debt summary, or learned rules during normal task execution.
