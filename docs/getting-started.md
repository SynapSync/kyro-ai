# Getting Started with Kyro

Kyro is a portable, markdown-first workflow kit for AI coding agents. It coordinates sprint-based execution through one orchestrator, reusable skills, command intent documents, persistent project rules, and `.agents/sprint-forge/{scope}/` artifacts.

Kyro does not require a specific model provider. Any capable agent — Cursor, Codex, OpenCode, Kilo Code, Claude Code, or a custom LLM API — can use the same core files.

---

## Prerequisites

- **Node.js >= 18** -- required for deterministic scripts (`check:post-edit`, `kyro:state`, etc.)
- **Git** -- recommended for project workflows and review
- **An AI coding agent** -- any host that can read markdown instructions and write files

Verify your Node.js version:

```bash
node --version
# v18.0.0 or higher
```

---

## Generic Agent Setup (Recommended First)

Use this path for **any** agent without a native Kyro plugin:

```bash
git clone https://github.com/SynapSync/kyro-workflow.git ~/kyro-workflow
cd your-project
mkdir -p .agents .skills .agents/sprint-forge

cp -R ~/kyro-workflow/agents/orchestrator.md .agents/
cp -R ~/kyro-workflow/skills/sprint-forge .skills/sprint-forge
cp -R ~/kyro-workflow/skills/qa-review .skills/qa-review
cp ~/kyro-workflow/config.json .
```

Optional: copy a harness template from `adapters/`:

| Host | Template |
|------|----------|
| Any | `adapters/generic/AGENTS.snippet.md` → append to your `AGENTS.md` |
| Cursor | `adapters/cursor/kyro-workflow.mdc` → `.cursor/rules/` |
| Kilo Code | `adapters/kilo-code/onboarding-prompt.txt` |

Expose these files as project context or rules:

- `.agents/orchestrator.md`
- `.skills/sprint-forge/SKILL.md`
- `.skills/qa-review/SKILL.md`

Set `config.json` → `harness` to match your host (defaults work on any LLM):

```json
"harness": {
  "id": "generic",
  "capabilities": {
    "slash_commands": false,
    "subagents": false,
    "post_edit_hooks": false,
    "project_memory": false
  },
  "enforcement": "manual"
}
```

See [agent-adapters.md](agent-adapters.md) for Cursor, Codex, OpenCode, Kilo Code, and programmatic usage.

---

## Optional: Claude Code Native Adapter

Claude Code can register slash commands, the orchestrator, skills, and post-edit hooks automatically:

```bash
/plugin install SynapSync/kyro-workflow
```

For local development:

```bash
git clone https://github.com/SynapSync/kyro-workflow.git ~/.claude/plugins/kyro-workflow
cd ~/.claude/plugins/kyro-workflow
npm install
npm run build
claude --plugin-dir ~/.claude/plugins/kyro-workflow
```

When using the Claude adapter, set `harness.enforcement` to `hooks` and enable capabilities in `config.json`. See [adapters/claude-code/README.md](../adapters/claude-code/README.md).

---

## First Run

If your platform supports Kyro slash commands, start with:

```text
/kyro-workflow:forge analyze the authentication module
```

If your platform does not support slash commands, invoke the **forge** intent manually:

```text
Use Kyro forge mode. Read the orchestrator, sprint-forge, and qa-review instructions. Analyze the authentication module, produce findings, create or update the sprint artifacts under .agents/sprint-forge/{scope}/, and stop at each approval gate.
```

This starts the full sprint cycle:

1. The analysis phase explores the codebase in read-only mode.
2. You approve the analysis at Gate 1.
3. Kyro generates a sprint plan with phases and tasks.
4. You approve the plan at Gate 2.
5. Tasks are executed one by one and validated.
6. You approve the implementation at Gate 3.
7. A retrospective is run and the sprint is closed.

To check progress, use the **status** intent or ask the agent to read `.agents/sprint-forge/{scope}/`.

When `harness.enforcement` is `manual`, run after code edits:

```bash
npm run check:post-edit
```

---

## Output Structure

After running forge in INIT mode, Kyro creates a scope workspace:

```text
.agents/sprint-forge/{scope}/
├── README.md
├── ROADMAP.md
├── RE-ENTRY-PROMPTS.md
├── findings/
├── sprints/
└── handoffs/
```

Project rules are stored in:

```text
.agents/sprint-forge/rules.md
```

The artifact files are the compatibility layer. Any agent that can read and write these files can continue the Kyro workflow.

---

## Key Concepts

### Modes

| Mode | When to Use | What It Does |
| --- | --- | --- |
| INIT | Starting a new project workflow | Analyzes the codebase, generates findings, creates a roadmap, and scaffolds the output directory |
| SPRINT | Ready to work on the next iteration | Generates a sprint from the roadmap and previous retro, then optionally executes it task by task |
| STATUS | Checking progress | Reads sprint files and reports progress, debt status, and next sprint context |

### Gates

Gates are mandatory approval checkpoints. Kyro never proceeds past a gate without explicit user approval:

- **Gate 1** -- after analysis, before planning
- **Gate 2** -- after sprint plan generation, before implementation
- **Gate 3** -- after implementation, before review and close

### Checkpoints

Sprint files are saved to disk after each phase completes. This keeps progress recoverable across session restarts, context compaction, or switching agents.

### Rules

When you correct an agent during a sprint, the correction can become a persistent project rule:

```text
User correction -> proposed rule -> user approval -> .agents/sprint-forge/rules.md
```

Rules are specific, dated, and tied to the project where they were learned. See [rules-guide.md](rules-guide.md).

### Debt Tracking

Technical debt is tracked formally across sprints. Items are never deleted; only their status changes.

---

## Next Steps

- [Agent Adapters](agent-adapters.md) -- harness matrix and per-platform setup
- [HOW-TO-USE-CURSOR.md](HOW-TO-USE-CURSOR.md) -- Cursor-specific guide
- [HOW-TO-USE-KILO-CODE.md](HOW-TO-USE-KILO-CODE.md) -- Kilo Code guide
- [Commands Reference](commands-reference.md) -- syntax and manual intents
- [Agents Reference](agents-reference.md) -- orchestrator protocols
- [Architecture](architecture.md) -- core vs adapters
