# OpenCode Adapter Guide

This guide describes manual Kyro usage with OpenCode-style agents. Native command or skill registration depends on the host environment; Kyro compatibility comes from referencing portable markdown files.

---

## Setup

```bash
mkdir -p .skills .agents .agents/sprint-forge

cp -r kyro-workflow/skills/sprint-forge .skills/
cp -r kyro-workflow/skills/qa-review .skills/
cp kyro-workflow/agents/orchestrator.md .agents/
```

Recommended project structure:

```text
your-project/
├── .agents/
│   ├── orchestrator.md
│   └── sprint-forge/
│       └── {scope}/
├── .skills/
│   ├── sprint-forge/
│   └── qa-review/
└── src/
```

---

## Onboarding Prompt

```text
Use Kyro for this project.

Read:
@file .agents/orchestrator.md
@file .skills/sprint-forge/SKILL.md
@file .skills/qa-review/SKILL.md

Persist workflow artifacts under .agents/sprint-forge/{scope}/.
If slash commands are unavailable, use:
- forge = analyze/plan/execute/review/close
- status = read artifacts and report progress/debt
- wrap-up = close session and update re-entry prompts
```

---

## Example Flows

### Sprint Planning

```text
@file .agents/orchestrator.md
@file .skills/sprint-forge/SKILL.md

Run the forge intent for {scope}.
Create or update ROADMAP.md, findings, and the next sprint under
.agents/sprint-forge/{scope}/.
```

### QA Review

```text
@file .skills/qa-review/SKILL.md
@file .agents/sprint-forge/{scope}/RE-ENTRY-PROMPTS.md

Review the current implementation against the sprint plan.
Return blockers first, then warnings, then approval status.
```

### Session Wrap-Up

```text
@file .agents/orchestrator.md
@file .skills/sprint-forge/SKILL.md

Run the wrap-up intent for {scope}.
Update retro notes, debt status, re-entry prompts, and proposed learned rules.
```

---

## Limitations

- OpenCode may not register Kyro commands or skills natively.
- You must ensure generated artifacts are saved under `.agents/sprint-forge/{scope}/`.
- Learned rules are markdown-based and must be maintained in `rules.md`.

For the generic adapter contract and Cursor notes, see [Agent Adapters](agent-adapters.md).
