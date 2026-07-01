# OpenCode Adapter Guide

OpenCode should discover Kyro through native OpenCode skills and slash commands. Do not copy Kyro core into each project.

## Setup

```bash
npx kyro-ai install --agent opencode --scope workspace --yes
```

This installs:

- global runtime: `~/.agents/kyro/current/`
- native OpenCode skills: `~/.config/opencode/skills/kyro-*`
- native OpenCode commands: `~/.config/opencode/commands/kyro/*.md`
- OpenCode agent overlay: `~/.config/opencode/opencode.json` key `agent.kyro-orchestrator`
- project state: `.agents/kyro/kyro.json`

## Usage

Use the installed commands or command-like skills:

- `/kyro/forge` or `kyro-forge` — route analyze/plan/execute/review/close
- `/kyro/status` or `kyro-status` — summary-first progress and debt report
- `/kyro/wrap-up` or `kyro-wrap-up` — close session and refresh handoff context

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

## Verify

```bash
kyro doctor
kyro doctor --tokens
```
