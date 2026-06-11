# Cursor Adapter Guide

Cursor can use Kyro through project rules and referenced files. Kyro is provider-neutral — any model available in Cursor can follow the workflow.

---

## Setup

```bash
mkdir -p .skills .agents .agents/sprint-forge

cp -r kyro-workflow/skills/sprint-forge .skills/
cp -r kyro-workflow/skills/qa-review .skills/
cp kyro-workflow/agents/orchestrator.md .agents/
cp kyro-workflow/config.json .
```

Copy the Cursor rule template:

```bash
mkdir -p .cursor/rules
cp kyro-workflow/adapters/cursor/kyro-workflow.mdc .cursor/rules/
```

Or append `adapters/generic/AGENTS.snippet.md` to your project's `AGENTS.md`.

---

## config.json

```json
"harness": {
  "id": "cursor",
  "capabilities": {
    "slash_commands": false,
    "subagents": true,
    "post_edit_hooks": false,
    "project_memory": false
  },
  "enforcement": "manual"
}
```

Set `subagents` to `true` if your Cursor setup supports parallel subagents for INIT fan-out and isolated QA review.

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
Use Kyro forge intent for {scope}.
Read .agents/orchestrator.md and .skills/sprint-forge/SKILL.md.
Do not invent a custom planning format.
```

### Status

```text
Run Kyro status intent for .agents/sprint-forge/{scope}/.
Report sprint progress, open debt, and next action.
```

### QA Review

```text
Read .skills/qa-review/SKILL.md and the focused references for this review type.
Review the current diff against the sprint plan.
Return blockers first, then warnings, then approval status.
```

---

## Optional Hooks

See `adapters/cursor/hooks.example.json` for an optional post-edit hook pattern. If you enable hooks, set `harness.enforcement` to `hooks` and `harness.capabilities.post_edit_hooks` to `true`.

---

## Limitations

- Cursor does not register Kyro slash commands natively — use manual intents.
- Artifact persistence depends on the agent writing files correctly.
- No verified native Kyro plugin for Cursor — setup is copy-and-customize.

See [agent-adapters.md](agent-adapters.md) and [adapters/README.md](../adapters/README.md).
