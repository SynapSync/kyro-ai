# Codex Adapter Guide

Codex should use the installed Kyro command skills and root `AGENTS.md` bootstrap. Do not load the whole runtime manually.

## Setup

```bash
npx kyro-ai install --agent codex --scope workspace --yes
```

This installs:

- global runtime: `~/.agents/kyro/current/`
- global command skills: `~/.agents/skills/kyro-*`
- project state: `.agents/kyro/kyro.json`
- a small Kyro managed block in root `AGENTS.md`

## Usage

Invoke the command-like skills:

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
