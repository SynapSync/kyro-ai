# OpenCode Adapter Guide

OpenCode should discover Kyro through global command skills. Do not copy Kyro core into each project.

## Setup

```bash
npx kyro-ai install --agent opencode --scope workspace --yes
```

This installs:

- global runtime: `~/.agents/kyro/current/`
- global command skills: `~/.agents/skills/kyro-*`
- project state: `.agents/kyro/kyro.json`

## Usage

Use the installed command-like skills:

- `kyro-forge` — route analyze/plan/execute/review/close
- `kyro-status` — summary-first progress and debt report
- `kyro-wrap-up` — close session and refresh handoff context

Each skill is intentionally tiny. It loads the command router first, then only the mode/helper/template needed for the current step.

## Artifacts

Save workflow artifacts under:

```text
.agents/kyro/scopes/{scope}/
├── state.json
├── index.json
├── ROADMAP.md
├── ROADMAP.summary.json
└── phases/
    ├── SPRINT-N-*.md
    └── SPRINT-N-*.summary.json
```

## Verify

```bash
kyro doctor
kyro doctor --tokens
```
