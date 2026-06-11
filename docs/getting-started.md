# Getting Started with Kyro

Kyro is a portable, markdown-first workflow kit for AI coding agents. It coordinates sprint-based execution through one orchestrator, reusable skills, command intent documents, persistent project rules, and `.agents/sprint-forge/{scope}/` artifacts.

Kyro does not require a specific model provider or language stack. Any capable agent — Cursor, Codex, OpenCode, Kilo Code, Claude Code, or a custom LLM API — can use the same core files.

---

## Prerequisites

- **Node.js >= 18** — required for `npx @synapsync/kyro-workflow init` and deterministic scripts
- **Git** — recommended for project workflows and review
- **An AI coding agent** — any host that can read markdown instructions and write files

Verify your Node.js version:

```bash
node --version
# v18.0.0 or higher
```

---

## Install (Recommended)

From your project root:

```bash
npx @synapsync/kyro-workflow init
```

In Cursor (also installs `.cursor/rules/kyro-workflow.mdc`):

```bash
npx @synapsync/kyro-workflow init --cursor
```

Verify the installation:

```bash
npx kyro-workflow doctor
```

### What `init` does

| Step | Result |
|------|--------|
| Copies orchestrator + skills | `.agents/orchestrator.md`, `.skills/sprint-forge/`, `.skills/qa-review/` |
| Writes stack-agnostic config | `config.json` with `quality_gates: {}` and `harness.id: "auto"` |
| Detects harness | Runs `harness-detect --apply` |
| Merges npm scripts | `check:post-edit`, `check:pre-commit`, `kyro:gate` via `kyro-workflow run` |
| Records install manifest | `.kyro/install.json` for path resolution |

Projects without an existing `package.json` get a minimal one with Kyro scripts only.

> **Do not use `npx skills add` for Kyro v3.** That command installs skills in isolation. The full workflow requires `npx @synapsync/kyro-workflow init`.

---

## Optional: Claude Code Native Adapter

Claude Code can register slash commands, the orchestrator, skills, and post-edit hooks automatically:

```bash
/plugin install SynapSync/kyro-workflow
```

You can use the plugin **or** `npx @synapsync/kyro-workflow init` — both install the same markdown core.

For local plugin development:

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

Or without a local `package.json`:

```bash
npx kyro-workflow run check:post-edit
```

---

## Configure Quality Gates

Fresh installs ship with empty `quality_gates` so Python, Flutter, Go, and other stacks are not forced into npm scripts. Add your commands when ready:

```json
"quality_gates": {
  "test": "pytest",
  "lint": "ruff check ."
}
```

```json
"quality_gates": {
  "analyze": "flutter analyze",
  "test": "flutter test"
}
```

```json
"quality_gates": {
  "typecheck": "npm run typecheck",
  "build": "npm run build"
}
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

## Advanced: Manual Installation

Use this only when npm is unavailable in the target environment:

```bash
git clone https://github.com/SynapSync/kyro-workflow.git ~/kyro-workflow
cd your-project
mkdir -p .agents .skills .agents/sprint-forge

cp -R ~/kyro-workflow/agents/orchestrator.md .agents/
cp -R ~/kyro-workflow/skills/sprint-forge .skills/sprint-forge
cp -R ~/kyro-workflow/skills/qa-review .skills/qa-review
cp ~/kyro-workflow/templates/config.default.json config.json
```

Optional harness templates from `adapters/`:

| Host | Template |
|------|----------|
| Any | `adapters/generic/AGENTS.snippet.md` → append to your `AGENTS.md` |
| Cursor | `adapters/cursor/kyro-workflow.mdc` → `.cursor/rules/` |
| Kilo Code | `adapters/kilo-code/onboarding-prompt.txt` |

See [agent-adapters.md](agent-adapters.md) for per-platform details.

---

## Next Steps

- [Agent Adapters](agent-adapters.md) -- harness matrix and per-platform setup
- [HOW-TO-USE-CURSOR.md](HOW-TO-USE-CURSOR.md) -- Cursor-specific guide
- [HOW-TO-USE-KILO-CODE.md](HOW-TO-USE-KILO-CODE.md) -- Kilo Code guide
- [Commands Reference](commands-reference.md) -- syntax and manual intents
- [Agents Reference](agents-reference.md) -- orchestrator protocols
- [Architecture](architecture.md) -- core vs adapters
