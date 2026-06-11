## Kyro Workflow

This project uses [Kyro](https://github.com/SynapSync/kyro-workflow) for sprint-based AI-assisted development.

**Read first:**
- `.agents/orchestrator.md` (or `.agents/kyro/orchestrator.md` if copied there)
- `.skills/sprint-forge/SKILL.md`
- `.skills/qa-review/SKILL.md`

**Artifact root:** `.agents/sprint-forge/{scope}/`

**Workflow intents** (use when slash commands are unavailable):
- `forge` — analyze, plan, execute, review, and close the sprint
- `status` — read artifacts and report progress/debt
- `wrap-up` — close session and update re-entry prompts

**Deterministic checks** (run after code edits when hooks are not configured):
```bash
npm run check:post-edit
npm run check:pre-commit
```

Set `config.json` → `harness.capabilities` to match this host. Defaults (`subagents: false`, `enforcement: manual`) work on any LLM.
