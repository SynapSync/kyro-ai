# Codex Adapter Guide

Codex should use the installed Kyro command skills and, when integrations are enabled, the root `AGENTS.md` bootstrap. Do not load the whole runtime manually.

## Setup

```bash
npm install -g kyro-ai
cd /path/to/your-app
kyro install --init-workspace --yes
```

One install projects all detected, enabled harnesses; no per-harness `--agent` is required. `--agent` is an explicit selection/re-enable and still requires detection. Manage persistent machine choices with `kyro adapters list|enable|disable`. See [Agent adapters](agent-adapters.md) for migration and opt-out.

This installs:

- global runtime: `~/.agents/kyro/current/`
- global command skills: `~/.agents/skills/kyro-*`
- project state: `.agents/kyro/project.json` + `local.json`

To opt in to the managed root `AGENTS.md` block and Codex MCP registration, run `kyro adapters enable codex --integrations` from this initialized workspace. Fresh installs leave these config files unchanged without opt-in.

## Usage

Invoke the command-like skills:

- `kyro-work` — explicitly chosen Work lifecycle
- `kyro-forge` — route analyze/plan/execute/review/close
- `kyro-status` — summary-first progress and debt report
- `kyro-task-context` — generate a copy-paste prompt for a fresh context
- `kyro-idea` — mature a rough or developed idea into an evidence-grounded, execution-ready plan (optional, pre-scope)

The skills read command routers from `~/.agents/kyro/current/commands/` and then load only the routed mode/helper/template.

## Artifacts

Persist scope artifacts under:

```text
.agents/kyro/scopes/{scope}/
├── sprint.json          # single source of truth
├── archive/             # write-only, at sprint close
└── findings/            # write-only INIT analysis evidence
```

`sprint.json` is the single source of truth for the scope. `archive/` and `findings/` are write-only evidence directories.

## Tool-owned state changes

Changes to `sprint.json` go through Kyro's tool-owned CLI verbs — they run identically here as on Claude, through your shell, and never require hand-editing the file:

- `kyro plan --from <file> --kyro-scope <scope>` — bootstrap a scope (init mode) or materialize the next sprint (sprint mode)
- `kyro record-evidence <task> --kyro-scope <scope> ...` — record maker evidence on a task
- `kyro review <task> --kyro-scope <scope> --verdict pass|fail` — record the checker verdict
- `kyro debt add|start|resolve|defer|escalate` — track technical debt
- `kyro add-emergent --title <t> --description <d> --acceptance <a>` — add a task discovered mid-sprint

These deterministic gates live in the Kyro CLI, so Codex gets the same enforcement as Claude. See [cli.md](cli.md) and [agent-adapters.md](agent-adapters.md).

## Verify

```bash
kyro doctor
kyro doctor --tokens
```
