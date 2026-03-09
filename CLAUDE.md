# Kyro — Workflow

## Overview

Kyro is a **workflow** (not a standalone skill) that orchestrates sprint-based project execution through specialized agents, lifecycle hooks, and persistent learning.

## Architecture: Command → Agent → Skill

```
User Command (/forge, /sprint, /status, /debt, /retro, /wrap-up, /insights, /deslop, /parallel)
  └── Agent (explorer, reviewer, debugger, orchestrator)
        └── Skill (kyro-workflow, kyro-learner, kyro-reviewer, kyro-metrics, kyro-handoff, kyro-analyzer, deslop)
              └── Hook (lifecycle events that fire automatically)
```

## Directory Structure

```
kyro-workflow/
├── agents/           # 4 specialized agents
│   ├── explorer.md   # Read-only codebase analysis (INIT)
│   ├── reviewer.md   # Task quality validation (SPRINT)
│   ├── debugger.md   # Root cause analysis (on failure)
│   └── orchestrator.md # Full cycle coordinator (/forge)
├── commands/         # 9 slash commands
│   ├── forge.md      # /forge — full cycle with gates
│   ├── sprint.md     # /sprint — generate/execute next sprint
│   ├── status.md     # /status — metrics and debt heatmap
│   ├── debt.md       # /debt — manage technical debt
│   ├── retro.md      # /retro — sprint retrospective ritual
│   ├── wrap-up.md    # /wrap-up — session closure ritual
│   ├── insights.md   # /insights — DB-backed analytics
│   ├── deslop.md     # /deslop — AI slop removal
│   └── parallel.md   # /parallel — worktree parallel execution
├── hooks/            # Lifecycle event handlers
│   └── hooks.json    # 12 hook definitions
├── scripts/          # Hook implementation scripts
├── skills/           # 7 skills (domain knowledge)
│   ├── kyro-workflow/     # Core orchestration (from v1.x)
│   ├── kyro-analyzer/  # Analysis strategies per work type
│   ├── kyro-reviewer/  # Quality checklist (BLOCKER/WARNING/SUGGESTION)
│   ├── kyro-learner/   # Cross-project rule accumulation
│   ├── kyro-metrics/   # Velocity trends and debt heatmap
│   ├── kyro-handoff/   # Enriched context transfer
│   └── deslop/           # AI slop detection and removal
├── docs/             # 8 documentation guides
├── config.json       # Workflow configuration
├── marketplace.json  # Plugin marketplace metadata
├── package.json      # NPM package definition
├── .claude-plugin/   # Claude Code plugin metadata
└── .cursor-plugin/   # Cursor plugin metadata (must stay in sync with .claude-plugin)
```

## Key Conventions

- **Rules file**: `~/.kyro/rules.md` — persistent learned rules across all projects
- **Database**: `~/.kyro/data.db` — session stats and searchable learnings
- **Sprint output**: `{cwd}/.agents/kyro/{project}/` — per-project sprint documents
- **Checkpoint-per-phase**: Sprint file saved after each phase completes
- **Debt never disappears**: Items are only closed when explicitly resolved
- **Gates require approval**: Never proceed past a validation gate without user confirmation

## Development

```bash
npm install
npm run build
```

## Testing hooks

Hook scripts are in `scripts/` and read/write JSON via stdin/stdout following Claude Code's hook protocol.

```bash
node scripts/test-hooks.js
```

## Plugin Manifests

Two plugin manifests exist and must be kept in sync:

- `.claude-plugin/plugin.json` — Claude Code plugin metadata
- `.cursor-plugin/plugin.json` — Cursor plugin metadata

When updating version, description, or capabilities, update both files.
