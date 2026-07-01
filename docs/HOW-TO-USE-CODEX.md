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
- `kyro-wrap-up` — close session and refresh handoff context

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

## Verify

```bash
kyro doctor
kyro doctor --tokens
```
