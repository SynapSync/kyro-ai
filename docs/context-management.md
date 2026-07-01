# Context Management Guide

How to manage token limits, prevent context overflow, and use compaction strategies effectively with Kyro.

---

## Token Limits

AI models have finite context windows. When your conversation approaches the limit, older messages are compacted (summarized). This can cause loss of nuance.

| Factor | Guideline |
|--------|-----------|
| Root agent instructions | < 60 lines — loaded on every message |
| Total agent instructions | < 150 lines — larger files waste context on every turn |
| MCP servers | < 10 active MCPs — each adds tool definitions to context |
| MCP tools total | < 80 tools — tool descriptions consume tokens |
| `sprint.json` size | Keep the active sprint focused — closed sprints are snapshotted to `archive/` and cleared from the live file |

---

## Compaction Strategies

### What is compaction?

When the conversation approaches the context limit, the system compresses older messages into a summary. This preserves the most recent context but may lose details from earlier turns.

### Good compact points

Kyro is designed with natural compact points:

| Point | Why it's safe |
|-------|---------------|
| **Between phases** | `sprint.json.handoff.nextAction` and per-task evidence capture enough progress to resume |
| **After INIT analysis** | Findings are written to `findings/` — context can be rebuilt from them |
| **After sprint generation** | The active sprint block in `sprint.json` captures everything needed for execution |
| **Between sprints** | `sprint.json` `handoff` routing captures full project state |

### Bad compact points

| Point | Why it's risky |
|-------|----------------|
| **Mid-task** | Partial work may be lost — the task state is in the agent's memory |
| **During retro** | Retro insights come from the full execution context |
| **During debt table update** | Requires knowledge of what was resolved in this sprint |

### Proactive compaction

Set the environment variable to trigger compaction earlier (before the system forces it):

```bash
export CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50
```

This triggers compaction at 50% context usage instead of the default. Useful for long sprints with many phases.

---

## Context Pack Command

Use `kyro context-pack` to load the minimum routing context for a scope without opening the full `sprint.json`:

```bash
kyro context-pack --kyro-scope <scope>
kyro context-pack --kyro-scope <scope> --json
kyro context-pack --kyro-scope <scope> --task <id>
kyro context-pack --kyro-scope <scope> --task
```

Scope packs read `sprint.json` directly. Task packs add the matching task object from the active sprint, list evidence recorded on the task, and surface relevant conventions and debt entries without embedding the full sprint history.

Each pack includes budget routing from `config.json` `budgetClasses`: `budgetClass`, `reasoningTier`, `maxContextTokens`, and `budgetGuidance`. Selection follows `sprint.json.handoff.nextAction` and pack mode — for example, `execute_task` maps to the `execute` class.

Prefer scope packs at session start. Prefer task packs when executing a specific sprint task. Use bare `--task` to default to the sprint's next pending task.

If `--kyro-scope` is omitted, the command uses `activeScope` from `.agents/kyro/kyro.json`.

---

## Handoff Routing

`sprint.json.handoff` is Kyro's primary defense against context loss between sprints. It is updated at INIT, sprint close, and wrap-up — not after every task.

- Current sprint number and status
- `nextAction` — the mode the next session should route into
- Compact notes for common follow-ups (generate next sprint, execute, check status)

If compaction happens mid-session, a new agent can read `sprint.json.handoff` to recover full context.

---

## Tips for Large Projects

1. **One sprint per session** — For projects with 5+ sprints, start a new session for each sprint. `sprint.json.handoff` ensures continuity.

2. **Minimize CLAUDE.md** — Move detailed instructions to separate files that are loaded on-demand, not on every message.

3. **Use lighter models for read-only exploration** — The analysis phase reads many files. A lighter model can reduce cost when the task is status, inventory, or summarization. Use the strongest available model for implementation, debugging, and architecture decisions.

4. **Checkpoint leanly** — Kyro records compact task evidence directly on the task object in `sprint.json` during execution and writes the archive snapshot plus narrative at sprint close.

5. **Avoid loading unnecessary skills** — Each loaded skill adds to the context. Only invoke skills when needed.

---

## Pre-Compaction Checkpoint

Before context compaction, save compact sprint state:

- Logs a warning that compaction is about to happen
- Checks the active sprint and its latest compact task evidence in `sprint.json`
- Points to the scope's `sprint.json` path and current `handoff.nextAction`

This gives the agent (and user) a chance to save state before context is compressed.

## Cost model details

See [Cost Model](cost-model.md) for audited runtime paths and write policy.
