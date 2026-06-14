# Getting Started with Kyro

Kyro is a portable sprint workflow kit for AI coding agents. It installs a global runtime and tiny command skills, while each project keeps only state and artifacts under `.agents/kyro/`.

## Prerequisites

- Node.js >= 18
- Git
- An AI coding agent that can read `~/.agents/skills`, root `AGENTS.md`, slash commands, or markdown instructions

## Install

Default standard install:

```bash
npx kyro-ai install --scope workspace --yes
```

Agent-specific installs:

```bash
npx kyro-ai install --agent opencode --scope workspace --yes
npx kyro-ai install --agent codex --scope workspace --yes
```

Claude plugin support remains first-class through `.claude-plugin/` and Claude's plugin install flow.

## What gets installed

Global runtime:

```text
~/.agents/kyro/current/
├── commands/
├── core/
├── skills/
└── manifest.json
```

Global command skills:

```text
~/.agents/skills/
├── kyro-forge/SKILL.md
├── kyro-status/SKILL.md
└── kyro-wrap-up/SKILL.md
```

Project state:

```text
.agents/kyro/
├── kyro.json
└── scopes/
```

`kyro install` does not create scoped `state.json`; the forge/INIT workflow creates scoped state only when a scope exists.

## First run

Use the installed command skill or slash command:

```text
kyro-forge auth-refactor
```

or, in Claude-style slash command environments:

```text
/kyro:forge auth-refactor
```

Kyro routes progressively:

1. read `.agents/kyro/kyro.json`
2. resolve or create scope
3. read scoped `state.json` and `index.json` if present
4. load only the required mode: INIT, plan, execute, review, close, or recover
5. update Markdown evidence plus JSON summaries

## Scope output

After INIT, a scope looks like:

```text
.agents/kyro/scopes/{scope}/
├── README.md
├── ROADMAP.md
├── ROADMAP.summary.json
├── RE-ENTRY-PROMPTS.md
├── state.json
├── index.json
├── findings/
└── phases/
    ├── SPRINT-N-*.md
    └── SPRINT-N-*.summary.json
```

Markdown is the human-readable evidence. JSON files are the fast routing cache used to save tokens.

## Verify

```bash
kyro doctor
kyro doctor --tokens
```

`doctor --tokens` warns when command routers, projected skills, mode files, or AGENTS.md bootstrap instructions become too heavy.

## Next steps

- [CLI](cli.md)
- [Agent Adapters](agent-adapters.md)
- [Commands Reference](commands-reference.md)
- [Architecture](architecture.md)
