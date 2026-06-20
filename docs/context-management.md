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
| Sprint file size | Keep under 500 lines — use separate files for large sprints |

---

## Compaction Strategies

### What is compaction?

When the conversation approaches the context limit, the system compresses older messages into a summary. This preserves the most recent context but may lose details from earlier turns.

### Good compact points

Kyro is designed with natural compact points:

| Point | Why it's safe |
|-------|---------------|
| **Between phases** | Compact routing state and task events capture enough progress to resume |
| **After INIT analysis** | Findings are written to files — context can be rebuilt from them |
| **After sprint generation** | Sprint document captures everything needed for execution |
| **Between sprints** | Re-entry prompts capture full project state |

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

## Re-entry Prompts

Re-entry prompts are Kyro's primary defense against context loss between sprints. They are updated at INIT, sprint close, and wrap-up — not after every task.

- Current sprint number and status
- File paths for all project artifacts
- Pre-written prompts for common actions (generate next sprint, execute, check status)

If compaction happens mid-session, a new agent can use the re-entry prompt to recover full context.

---

## Tips for Large Projects

1. **One sprint per session** — For projects with 5+ sprints, start a new session for each sprint. Re-entry prompts ensure continuity.

2. **Minimize CLAUDE.md** — Move detailed instructions to separate files that are loaded on-demand, not on every message.

3. **Use lighter models for read-only exploration** — The analysis phase reads many files. A lighter model can reduce cost when the task is status, inventory, or summarization. Use the strongest available model for implementation, debugging, and architecture decisions.

4. **Checkpoint leanly** — Kyro records compact task evidence during execution and materializes full documentation at sprint close.

5. **Avoid loading unnecessary skills** — Each loaded skill adds to the context. Only invoke skills when needed.

---

## Pre-Compaction Checkpoint

Before context compaction, save compact sprint state:

- Logs a warning that compaction is about to happen
- Checks for active sprint and latest compact task evidence
- Points to the active sprint and re-entry prompt paths

This gives the agent (and user) a chance to save state before context is compressed.
