# Kilo Code Adapter Guide

Kilo Code can use Kyro through project context and manual prompts. Kyro does not ship a verified native Kilo Code plugin — compatibility comes from portable markdown files.

---

## Setup

```bash
mkdir -p .skills .agents .agents/sprint-forge

cp -r kyro-workflow/skills/sprint-forge .skills/
cp -r kyro-workflow/skills/qa-review .skills/
cp kyro-workflow/agents/orchestrator.md .agents/
cp kyro-workflow/config.json .
```

Add the onboarding prompt from `adapters/kilo-code/onboarding-prompt.txt` to your Kilo Code project instructions.

---

## config.json

```json
"harness": {
  "id": "kilo-code",
  "capabilities": {
    "slash_commands": false,
    "subagents": false,
    "post_edit_hooks": false,
    "project_memory": false
  },
  "enforcement": "manual"
}
```

Adjust `subagents` if your Kilo Code environment supports parallel agents.

---

## Onboarding Prompt

```text
Use Kyro for this project.

Read:
- .agents/orchestrator.md
- .skills/sprint-forge/SKILL.md
- .skills/qa-review/SKILL.md

Persist artifacts under .agents/sprint-forge/{scope}/.

Intents:
- forge = analyze/plan/execute/review/close
- status = read artifacts and report progress/debt
- wrap-up = close session and update re-entry prompts

After code edits: npm run check:post-edit
Before commit: npm run check:pre-commit
```

---

## Common Flows

### Forge

```text
Run the Kyro forge intent for {scope}.
Read .agents/orchestrator.md and create or update findings, ROADMAP, and sprint files under .agents/sprint-forge/{scope}/.
Stop at each approval gate.
```

### Status

```text
Run the Kyro status intent for .agents/sprint-forge/{scope}/.
Summarize completed sprints, open debt, and recommended next action.
```

### Wrap-Up

```text
Run the Kyro wrap-up intent for {scope}.
Update retro, debt table, re-entry prompts, and propose learned rules for rules.md.
```

---

## Deterministic Checks

```bash
npm run check:post-edit
npm run check:pre-commit
npm run check:pre-commit -- --skip-quality
```

---

## Limitations

- No native slash command registration — use manual intents.
- Hooks are not automatic — run scripts explicitly.
- Model selection is host-owned; Kyro does not prescribe a provider.

See [agent-adapters.md](agent-adapters.md) and [adapters/kilo-code/README.md](../adapters/kilo-code/README.md).
