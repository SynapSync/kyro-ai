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
├── dist/
├── package.json
├── config.json
└── manifest.json
```

Kyro keeps only this active runtime. Reinstalling or upgrading replaces
`current/`; old versioned runtime folders are cleaned instead of retained.

Global command skills:

```text
~/.agents/skills/
├── kyro-forge/SKILL.md
├── kyro-status/SKILL.md
├── kyro-task-context/SKILL.md
└── kyro-idea/SKILL.md
```

OpenCode installs equivalent native entrypoints:

```text
~/.config/opencode/
├── commands/kyro/
└── skills/kyro-*/
```

Project state:

```text
.agents/kyro/
├── kyro.json
└── scopes/
```

`kyro install` does not create a scoped `sprint.json`; the forge/INIT workflow creates it only when a scope is opened for the first time.

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
3. read the scope's `sprint.json` if present
4. route on `sprint.json.handoff.nextAction` and load only the required mode: INIT, clarify, plan, execute, review, close, or recover
5. record compact task evidence directly on the task object in `sprint.json` during execution, then write the archive snapshot and narrative at sprint close

## Scope output

After INIT, a scope looks like:

```text
.agents/kyro/scopes/{scope}/
├── sprint.json          # single source of truth
├── archive/             # write-only, at sprint close
└── findings/            # write-only INIT analysis evidence
```

`sprint.json` is the single source of truth — it holds the objective, success criteria, roadmap, active sprint, debt, conventions, and handoff routing. `archive/` receives a verbatim snapshot plus a human narrative each time a sprint closes.

## Verify

```bash
kyro doctor
kyro doctor --tokens
```

Use the full npm package CLI (`npx kyro-ai` or a global `kyro` install) for install, sync, and `doctor --tokens`. Day-to-day agent workflow uses the installed skills under `~/.agents/skills/kyro-*` and the projected runtime at `~/.agents/kyro/current/` (including `doctor --artifacts` via the substituted CLI invocation).

`doctor --tokens` audits realistic Kyro runtime paths and fails forbidden eager helper loading or over-budget paths.

## Next steps

- [CLI](cli.md)
- [Agent Adapters](agent-adapters.md)
- [Commands Reference](commands-reference.md)
- [Architecture](architecture.md)
