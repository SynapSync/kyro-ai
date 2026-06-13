# Getting Started with Kyro

Kyro is a portable, markdown-first workflow kit for AI coding agents. It coordinates sprint-based execution through one orchestrator, reusable skills, command intent documents, persistent project rules, and `.agents/kyro/scopes/{scope}/` artifacts.

Kyro does not require a specific model provider. Claude Code is supported through a native adapter, while Codex, OpenCode, Cursor, and generic agents can use the same core files manually.

---

## Prerequisites

- **Node.js >= 18** -- required to build and package Kyro
- **Git** -- recommended for project workflows and review
- **An AI coding agent** -- Claude Code, Codex, OpenCode, Cursor, or another agent that can read markdown instructions

Verify your Node.js version:

```bash
node --version
# v18.0.0 or higher
```

---

## Installation Paths

### Claude Code Adapter

Use this path when you want Claude Code to register Kyro slash commands, agents, and skills automatically:

```bash
/plugin install SynapSync/kyro-ai
```

For local development:

```bash
git clone https://github.com/SynapSync/kyro-ai.git ~/.claude/plugins/kyro-ai
cd ~/.claude/plugins/kyro-ai
npm install
npm run build
claude --plugin-dir ~/.claude/plugins/kyro-ai
```

### Generic Agent Setup

Use this path for agents without a verified Kyro-native plugin mechanism:

```bash
git clone https://github.com/SynapSync/kyro-ai.git ~/kyro-ai
cd your-project
mkdir -p .agents .skills
cp -R ~/kyro-ai/agents .agents/kyro
cp -R ~/kyro-ai/skills/core .skills/core
cp -R ~/kyro-ai/skills/qa-review .skills/qa-review
mkdir -p .agents/kyro/scopes
```

Then expose these files as project context or rules in your agent:

- `.agents/kyro/orchestrator.md`
- `.skills/core/SKILL.md`
- `.skills/qa-review/SKILL.md`
- Kyro command intent files from `commands/*.md`, when your agent supports slash commands or reusable prompts

See [agent-adapters.md](agent-adapters.md) for Codex, OpenCode, Cursor, and generic AGENTS guidance.

---

## First Run

If your platform supports Kyro slash commands, start with:

```text
/kyro:forge analyze the authentication module
```

If your platform does not support slash commands, invoke the same intent manually:

```text
Use Kyro forge mode. Read the orchestrator, core, and qa-review instructions. Analyze the authentication module, produce findings, create or update the sprint artifacts under .agents/kyro/scopes/{scope}/, and stop at each approval gate.
```

This starts the full sprint cycle:

1. The analysis phase explores the codebase in read-only mode.
2. You approve the analysis at Gate 1.
3. Kyro generates a sprint plan with phases and tasks.
4. You approve the plan at Gate 2.
5. Tasks are executed one by one and validated.
6. You approve the implementation at Gate 3.
7. A retrospective is run and the sprint is closed.

To check progress, use `/kyro:status` or ask the agent to run Kyro status mode by reading `.agents/kyro/scopes/{scope}/`.

---

## Output Structure

After running forge in INIT mode, Kyro creates a scope workspace:

```text
.agents/kyro/scopes/{scope}/
├── README.md
├── ROADMAP.md
├── RE-ENTRY-PROMPTS.md
├── findings/
├── phases/
└── handoffs/
```

Project rules are stored in:

```text
.agents/kyro/scopes/rules.md
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
User correction -> proposed rule -> user approval -> .agents/kyro/scopes/rules.md
```

Rules are specific, dated, and tied to the project where they were learned. See [rules-guide.md](rules-guide.md).

### Debt Tracking

Technical debt is tracked formally across sprints. Items are never deleted; only their status changes.

---

## Next Steps

- [Agent Adapters](agent-adapters.md) -- setup guidance for Claude Code, Codex, OpenCode, Cursor, and generic agents
- [Commands Reference](commands-reference.md) -- syntax and examples for all 3 command intents
- [Agents Reference](agents-reference.md) -- how the orchestrator and protocols work
- [Rules Guide](rules-guide.md) -- the per-project learning system
- [Architecture](architecture.md) -- system design and data flow
