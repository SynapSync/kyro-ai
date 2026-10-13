# OpenCode Adapter Guide

OpenCode should discover Kyro through native OpenCode skills and slash commands. Do not copy Kyro core into each project.

## Setup

```bash
npm install -g kyro-ai
cd /path/to/your-app
kyro install --init-workspace --yes
```

One install projects all detected, enabled harnesses; no per-harness `--agent` is required. `--agent` is an explicit selection/re-enable and still requires detection. Manage persistent machine choices with `kyro adapters list|enable|disable`. See [Agent adapters](agent-adapters.md) for migration and opt-out.

This installs:

- global runtime: `~/.agents/kyro/current/`
- native OpenCode skill links (copy fallback): `~/.config/opencode/skills/kyro-*`
- native OpenCode commands: `~/.config/opencode/commands/kyro/*.md`
- project state: `.agents/kyro/project.json` + `local.json`

To opt in to the OpenCode `agent.kyro-orchestrator` overlay, run `kyro adapters enable opencode --integrations`. Fresh installs leave `opencode.json` unchanged without opt-in; native command files are still projected.

## Usage

Use the installed commands or command-like skills:

- `/kyro/work` or `kyro-work` — explicitly chosen Work lifecycle
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
