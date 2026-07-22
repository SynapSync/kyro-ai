# OpenCode Adapter Guide

OpenCode should discover Kyro through native OpenCode skills and slash commands. Do not copy Kyro core into each project.

## Setup

```bash
cd /path/to/your-app
npx kyro-ai@latest install --agent opencode --scope workspace --init-workspace --yes
```

This installs:

- global runtime: `~/.agents/kyro/current/`
- native OpenCode skills: `~/.config/opencode/skills/kyro-*`
- native OpenCode commands: `~/.config/opencode/commands/kyro/*.md`
- OpenCode agent overlay: `~/.config/opencode/opencode.json` key `agent.kyro-orchestrator`
- project state: `.agents/kyro/project.json` + `local.json` (legacy `kyro.json` dual-read)

## Usage

Use the installed commands or command-like skills:

- `/kyro/forge` or `kyro-forge` — route analyze/plan/execute/review/close
- `/kyro/status` or `kyro-status` — summary-first progress and debt report
- `/kyro/task-context` or `kyro-task-context` — generate a copy-paste prompt for a fresh context
- `/kyro/idea` or `kyro-idea` — mature a rough or developed idea into an evidence-grounded, execution-ready plan (optional, pre-scope)

Each skill is intentionally tiny. It loads the command router first, then only the mode/helper/template needed for the current step.

Kyro owns only the `agent.kyro-orchestrator` entry in `opencode.json`. Existing models, agents, MCP servers, providers, and other OpenCode settings are preserved.

## Artifacts

Save workflow artifacts under:

```text
.agents/kyro/scopes/{scope}/
├── sprint.json          # single source of truth
├── archive/             # write-only, at sprint close
└── findings/            # write-only INIT analysis evidence
```

## Tool-owned state changes

Changes to `sprint.json` go through Kyro's tool-owned CLI verbs — they run identically here as on Claude, through your shell, and never require hand-editing the file:

- `kyro plan --from <file> --kyro-scope <scope>` — bootstrap a scope (init mode) or materialize the next sprint (sprint mode)
- `kyro record-evidence <task> --kyro-scope <scope> ...` — record maker evidence on a task
- `kyro review <task> --kyro-scope <scope> --verdict pass|fail` — record the checker verdict
- `kyro debt add|start|resolve|defer|escalate` — track technical debt
- `kyro add-emergent --title <t> --description <d> --acceptance <a>` — add a task discovered mid-sprint

These deterministic gates live in the Kyro CLI, so OpenCode gets the same enforcement as Claude. See [cli.md](cli.md) and [agent-adapters.md](agent-adapters.md).

## Verify

```bash
kyro doctor
kyro doctor --tokens
```
