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

JSON packs also include **`cliRecipes[]`**: copy-paste commands for the current `nextAction` (plus `status` / `doctor --artifacts` preflight), built with the canonical agent CLI entrypoint from the global runtime manifest. Prefer recipes over re-discovering invocation or re-inflating skill stubs.

Prefer scope packs at session start. Prefer task packs when executing a specific sprint task. Use bare `--task` to default to the sprint's next pending task.

If `--kyro-scope` is omitted, the command uses `activeScope` from layered project state (`local.json` / effective merge).

### Task packs for delegate briefs

When delegating to an implementer or checker delegate, the orchestrator builds the brief from a **task pack**, not the full `sprint.json`:

```bash
kyro context-pack --kyro-scope <scope> --task <id> --json
```

The pack includes task identity, `files_to_touch`, acceptance criteria, conventions, and routing fields. JSON also includes `delegationEnabled` from `local.json` `execution.delegationEnabled` (`false` when unset). When `true`, execute/review modes load `delegates/implementer.md` or `delegates/checker.md`.

**Implementer status contract** (returned to orchestrator):

```json
{
  "taskId": "T1.1",
  "status": "done",
  "summary": "...",
  "filesChanged": ["path/..."],
  "validation": { "ran": true, "command": "...", "ok": true },
  "blockers": []
}
```

The orchestrator maps `done` + valid validation → `kyro record-evidence`; `blocked` → evidence with `--status blocked`. Delegates must not run `record-evidence` or `review` themselves.

See [Architecture — Delegated execution](architecture.md#delegated-execution-protocol-opt-in) and [CLI — Context Pack](cli.md#context-pack).

---

## Search Output Guard

The single biggest measured token cost in real Kyro runs is not the workflow engine — it is
**unbounded tool output**: a broad `rg`/`grep -r` with no cap can pull tens of thousands of
tokens into context in one call, and that stays billed on every later turn.

The Claude Code plugin ships a `PreToolUse` hook (`guard-bash-output.mjs`) that **blocks a
recursive search only when it has no output bound at all** — no cap, no scope, no redirect. It
never touches tests or non-search commands, and it fails open on anything ambiguous. When it
fires, it hands back the bounded form; re-run with any one of:

| Make it bounded | Example |
|-----------------|---------|
| Cap the results | `rg 'pat' -m 50`  ·  `rg 'pat' \| head -50` |
| List files / count only | `rg -l 'pat'`  ·  `rg -c 'pat'` |
| Scope to a path or glob | `rg 'pat' src/feature`  ·  `rg 'pat' --glob '*.ts'` |
| Keep it all off-context | `rg 'pat' > /tmp/hits.txt`, then read what you need |

Tests are never hard-blocked (a full run is sometimes the right validation), but the same
discipline applies: scope tests to the touched files instead of re-running the whole suite at
every validation point.

---

## Handoff Routing

`sprint.json.handoff` is Kyro's primary defense against context loss between sprints. It is updated at INIT and sprint close — not after every task.

- Current sprint number and status
- `nextAction` — the mode the next session should route into
- Compact notes for common follow-ups (generate next sprint, execute, check status)

If compaction happens mid-session, a new agent can read `sprint.json.handoff` to recover full context.

---

## Tips for Large Projects

1. **One sprint per session** — For projects with 5+ sprints, start a new session for each sprint. `sprint.json.handoff` ensures continuity.

2. **Minimize CLAUDE.md** — Move detailed instructions to separate files that are loaded on-demand, not on every message.

3. **Use lighter models for read-only exploration** — The analysis phase reads many files. A lighter model can reduce cost when the task is status, inventory, or summarization. Use the strongest available model for implementation, debugging, and architecture decisions.

4. **Checkpoint leanly** — Kyro records task evidence and status through tool-owned CLI verbs (`kyro record-evidence`, `kyro review`) during execution and writes the archive snapshot plus narrative at sprint close via `kyro close-sprint`.

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
