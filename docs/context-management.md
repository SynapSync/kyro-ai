# Context Management Guide

How to manage token limits, prevent context overflow, and use compaction strategies effectively with Kyro.

---

## Token Limits

AI models have finite context windows. When your conversation approaches the limit, older messages are compacted (summarized). This can cause loss of nuance.

| Factor | Guideline |
|--------|-----------|
| CLAUDE.md (root) | < 60 lines — loaded on every message |
| CLAUDE.md (total, all nested) | < 150 lines — larger files waste context on every turn |
| MCP servers | < 10 active MCPs — each adds tool definitions to context |
| MCP tools total | < 80 tools — tool descriptions consume tokens |
| Sprint file size | Keep under 500 lines — use separate files for large sprints |

---

## Kyro Context Config

`config.json` has a context section:

```json
"context": {
  "warning_threshold_percent": 70,
  "auto_save_reentry": true
}
```

- **`warning_threshold_percent`**: When context usage exceeds this %, the `PreCompact` hook fires and warns about upcoming compaction.
- **`auto_save_reentry`**: Automatically save re-entry prompt state before compaction.

---

## Compaction Strategies

### What is compaction?

When the conversation approaches the context limit, the system compresses older messages into a summary. This preserves the most recent context but may lose details from earlier turns.

### Good compact points

Kyro is designed with natural compact points:

| Point | Why it's safe |
|-------|---------------|
| **Between phases** | Phase checkpoint saves all progress to the sprint file |
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

Re-entry prompts are Kyro's primary defense against context loss. After each sprint execution, re-entry prompts are updated with:

- Current sprint number and status
- File paths for all project artifacts
- Pre-written prompts for common actions (generate next sprint, execute, check status)

If compaction happens mid-session, a new agent can use the re-entry prompt to recover full context.

---

## Tips for Large Projects

1. **One sprint per session** — For projects with 5+ sprints, start a new session for each sprint. Re-entry prompts ensure continuity.

2. **Minimize CLAUDE.md** — Move detailed instructions to separate files that are loaded on-demand, not on every message.

3. **Use Haiku for exploration** — The analysis phase reads many files. Using Haiku keeps context cost low and leaves more room for implementation.

4. **Checkpoint aggressively** — Kyro checkpoints after each phase. This means progress survives compaction.

5. **Avoid loading unnecessary skills** — Each loaded skill adds to the context. Only invoke skills when needed.

---

## PreCompact Hook

Kyro's `context-warning.js` hook fires on the `PreCompact` event:

- Logs a warning that compaction is about to happen
- Checks for active sprint and reminds about re-entry prompts
- Points to the re-entry prompts file path

This gives the agent (and user) a chance to save state before context is compressed.
