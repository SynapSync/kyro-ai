# Agent Adapters

Kyro's adapter contract is: global runtime, global command skills, local project state. Agents should invoke Kyro through command-like skills or slash commands, not by loading the full workflow manually.

## Stable interface

| Interface | Purpose |
|-----------|---------|
| `~/.agents/kyro/current/commands/*.md` | Thin command routers |
| `~/.agents/kyro/current/skills/sprint-forge/` | Lazy-loaded workflow modes, helpers, templates |
| `~/.agents/skills/kyro-*` | Global command skills discovered by compatible agents |
| `.agents/kyro/kyro.json` | Project-level Kyro state |
| `.agents/kyro/scopes/{scope}/` | Scope artifacts, state, summaries, roadmap, sprints |
| root `AGENTS.md` | Small Codex/cross-agent bootstrap when the Codex adapter is installed |

## Install adapters

```bash
npx kyro-ai install --scope workspace --yes
npx kyro-ai install --agent opencode --scope workspace --yes
npx kyro-ai install --agent codex --scope workspace --yes
```

Implemented adapters:

| Adapter | Behavior |
|---------|----------|
| `standard` | Installs global `kyro-*` command skills for compatible agents. |
| `opencode` | Uses the same global command skill projection. |
| `codex` | Adds global command skills plus a small Kyro block in root `AGENTS.md`. |

There is intentionally no generic adapter. Root `AGENTS.md` is the standard cross-agent bootstrap.

## Command intents

| Intent | Command skill | Slash namespace |
|--------|---------------|-----------------|
| forge | `kyro-forge` | `/kyro:forge` |
| status | `kyro-status` | `/kyro:status` |
| wrap-up | `kyro-wrap-up` | `/kyro:wrap-up` |

Each skill loads its command router first. The router then names the exact mode/helper/template needed for the current step.

## Codex

Use:

```bash
npx kyro-ai install --agent codex --scope workspace --yes
```

Codex reads the managed root `AGENTS.md` block, discovers `~/.agents/skills/kyro-*`, and follows the router-first workflow.

## OpenCode

Use:

```bash
npx kyro-ai install --agent opencode --scope workspace --yes
```

OpenCode should invoke `kyro-forge`, `kyro-status`, and `kyro-wrap-up` from global skills. It should not copy Kyro core into the project.

## Claude

Claude plugin support remains first-class through `.claude-plugin/`. The CLI adapter path complements the plugin; it does not retire it.

## Cursor

Cursor adapter automation is planned. Until then, use the standard install and root `AGENTS.md`/global skills if your Cursor setup can read them.

## Compatibility rule

Keep platform-specific behavior in adapters. The core workflow must remain portable through command routers, scoped state, summaries, and Markdown artifacts.
