# Getting Started with Kyro

Kyro is a portable sprint workflow kit for AI coding agents (**kyro-ai**, `sprint.json` schema v4). It installs a global runtime and tiny command skills; each project keeps state under `.agents/kyro/`.

> New here? The [README](../README.md) is the client-facing tour. This page is the slightly deeper first-run guide.

## Prerequisites

- Node.js ≥ 18
- Git
- An AI coding agent that can read `~/.agents/skills`, root `AGENTS.md`, slash commands, or markdown instructions

## Install

**Run every install/sync from the project root** (the repository Kyro should manage). The global runtime and skills always land under your home directory; **project state** (`.agents/kyro/kyro.json` and registration of `scopes/`) is written relative to the **current working directory**. If you install from `~` or another folder, you still get the runtime—but Kyro state appears in the wrong place.

Always install and sync with **`npx kyro-ai@latest …`** so you get the current release (omit `@latest` only if you intentionally pin a version).

Default standard install:

```bash
cd /path/to/your-app
npx kyro-ai@latest install --scope workspace --init-workspace --yes
```

`--init-workspace` creates or refreshes `.agents/kyro/kyro.json` in this directory (non-interactive). It also **rehydrates** any existing `scopes/` folders (common after cloning a team repo that gitignores personal `kyro.json`).

Agent-specific installs (still from the project root):

```bash
npx kyro-ai@latest install --agent opencode --scope workspace --init-workspace --yes
npx kyro-ai@latest install --agent codex --scope workspace --init-workspace --yes
```

Claude Code can use the first-class plugin (see [README](../README.md#choose-your-host)); the CLI install still projects the shared runtime and project state when you want them—run it from the project root.

## What gets installed

Global runtime:

```text
~/.agents/kyro/current/
├── commands/
├── core/
├── skills/
├── dist/                 # projected CLI (dist/cli.js)
├── package.json
├── config.json
└── manifest.json         # includes kyroInvocation
```

Kyro keeps only this active runtime. Reinstalling or upgrading replaces `current/`; old versioned runtime folders are cleaned instead of retained.

Global command skills:

```text
~/.agents/skills/
├── kyro-forge/SKILL.md
├── kyro-status/SKILL.md
├── kyro-task-context/SKILL.md
├── kyro-idea/SKILL.md
└── kyro-qa/SKILL.md
```

OpenCode installs equivalent native entrypoints under `~/.config/opencode/` when you use `--agent opencode`.

Project state:

```text
.agents/kyro/
├── kyro.json
└── scopes/
```

`kyro install` does not create a scoped `sprint.json`; forge/INIT creates it when a scope is opened for the first time. If `scopes/` already has directories (for example after cloning a team repo that gitignores `kyro.json`), install/sync **registers** them into `kyro.json.scopes[]`. With multiple scopes, set yours with:

```bash
node ~/.agents/kyro/current/dist/cli.js scope set-active <scope> --yes
# or: kyro scope set-active <scope> --yes   # when a durable global bin exists
```

### CLI invocation (important)

`npx kyro-ai@latest install` does **not** permanently put `kyro` on PATH. Install/sync records a durable invocation in the **global** `manifest.json` only (bare `kyro` only if a real global bin exists; otherwise `node ~/.agents/kyro/current/dist/cli.js`). Projected modes under `current/` substitute that string for agents. Project `kyro.json` is not the source of truth for the CLI string — one install/sync refreshes invocation for every workspace on the machine.

After upgrades (from the project root):

```bash
cd /path/to/your-app
npx kyro-ai@latest sync --scope workspace --yes
```

See [CLI · invocation persistence](cli.md#cli-invocation-persistence-kyroinvocation).

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
3. read the scope's lean pack / `sprint.json` if present
4. route on `sprint.json.handoff.nextAction` and load only the required mode: INIT, clarify, plan, execute, review, close, done, or recover
5. record task evidence and status through **tool-owned CLI verbs** during execution (`record-evidence`, then `review` for the checker verdict — **no hand-editing** of `sprint.json`), then close via `close-sprint`

## Scope output

After INIT, a scope looks like:

```text
.agents/kyro/scopes/{scope}/
├── sprint.json          # single source of truth
├── archive/             # write-only, at sprint close
└── findings/            # write-only INIT analysis evidence
```

`sprint.json` holds the objective, success criteria, roadmap, active sprint, debt, conventions, ADRs, and handoff routing. `archive/` receives a verbatim snapshot plus a human narrative each time a sprint closes.

## Verify

```bash
node ~/.agents/kyro/current/dist/cli.js doctor
node ~/.agents/kyro/current/dist/cli.js doctor --artifacts
```

Use the **full npm package** (`npx kyro-ai@latest` or a global `kyro` from `npm i -g kyro-ai`) for `install`, `sync`, and `doctor --tokens`. Day-to-day workflow uses installed skills and the projected runtime CLI (including `doctor --artifacts`).

`doctor --tokens` audits realistic Kyro runtime paths and fails forbidden eager helper loading or over-budget paths — run it from the full package.

## Next steps

- [CLI](cli.md)
- [Agent adapters](agent-adapters.md)
- [Commands reference](commands-reference.md)
- [Architecture](architecture.md)
