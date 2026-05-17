# Codex Adapter Guide

This guide describes manual Kyro usage with Codex-style agents. Native command or skill registration depends on the specific Codex environment; Kyro compatibility comes from referencing portable markdown files.

---

## Setup

```bash
mkdir -p .skills .agents .agents/sprint-forge

cp -r kyro-workflow/skills/sprint-forge .skills/
cp -r kyro-workflow/skills/qa-review .skills/
cp kyro-workflow/agents/orchestrator.md .agents/
```

---

## Onboarding Prompt

```text
Use Kyro for this project.

Read:
- .agents/orchestrator.md
- .skills/sprint-forge/SKILL.md
- .skills/qa-review/SKILL.md

Persist workflow artifacts under .agents/sprint-forge/{scope}/.
If slash commands are unavailable, use these intents:
- forge = analyze/plan/execute/review/close
- status = read artifacts and report progress/debt
- wrap-up = close the session and update re-entry prompts
```

---

## Common Flows

### Review

```text
@file .skills/qa-review/SKILL.md

Review this change and return APPROVED, APPROVED WITH NOTES,
CHANGES REQUIRED, or REJECTED.

Context:
- Scope: {scope}
- Sprint artifacts: .agents/sprint-forge/{scope}/
```

### Forge

```text
@file .agents/orchestrator.md
@file .skills/sprint-forge/SKILL.md
@file .skills/qa-review/SKILL.md

Run the forge intent for {scope}.
Use .agents/sprint-forge/{scope}/ for findings, roadmap, sprints,
handoffs, and re-entry prompts.
```

### Status

```text
@file .skills/sprint-forge/SKILL.md

Run the status intent for .agents/sprint-forge/{scope}/.
Report sprint progress, open debt, aged debt, blockers, and next action.
```

---

## Limitations

- Codex environments may not register Kyro slash commands automatically.
- Artifact persistence depends on the agent writing files correctly.
- Learned rules work through `.agents/sprint-forge/rules.md`, not through a runtime service.

For generic setup and Cursor/OpenCode notes, see [Agent Adapters](agent-adapters.md).
