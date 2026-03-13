# Kyro — Workflow

## Overview

Kyro is a **workflow** (not a standalone skill) that orchestrates sprint-based project execution through specialized agents, lifecycle hooks, and persistent learning.

## Architecture: Command → Agent → Skill

```
User Command (/kyro-workflow:forge, /kyro-workflow:sprint, /kyro-workflow:status, /kyro-workflow:debt, /kyro-workflow:retro, /kyro-workflow:wrap-up, /kyro-workflow:insights, /kyro-workflow:deslop, /kyro-workflow:parallel)
  └── Agent (explorer, reviewer, debugger, orchestrator)
        └── Skill (sprint-forge, kyro-learner, kyro-reviewer, kyro-metrics, kyro-handoff, kyro-analyzer, deslop)
              └── Hook (lifecycle events that fire automatically)
```

## Directory Structure

```
kyro-workflow/
├── agents/           # 4 specialized agents
│   ├── explorer.md   # Read-only codebase analysis (INIT)
│   ├── reviewer.md   # Task quality validation (SPRINT)
│   ├── debugger.md   # Root cause analysis (on failure)
│   └── orchestrator.md # Full cycle coordinator (/kyro-workflow:forge)
├── commands/         # 9 slash commands
│   ├── forge.md      # /kyro-workflow:forge — full cycle with gates
│   ├── sprint.md     # /kyro-workflow:sprint — generate/execute next sprint
│   ├── status.md     # /kyro-workflow:status — metrics and debt heatmap
│   ├── debt.md       # /kyro-workflow:debt — manage technical debt
│   ├── retro.md      # /kyro-workflow:retro — sprint retrospective ritual
│   ├── wrap-up.md    # /kyro-workflow:wrap-up — session closure ritual
│   ├── insights.md   # /kyro-workflow:insights — DB-backed analytics
│   ├── deslop.md     # /kyro-workflow:deslop — AI slop removal
│   └── parallel.md   # /kyro-workflow:parallel — worktree parallel execution
├── hooks/            # Lifecycle event handlers
│   └── hooks.json    # 10 hook events, 15 hook entries
├── scripts/          # Hook implementation scripts
├── skills/           # 7 skills (domain knowledge)
│   ├── sprint-forge/      # Core orchestration (from v1.x)
│   ├── kyro-analyzer/  # Analysis strategies per work type
│   ├── kyro-reviewer/  # Quality checklist (BLOCKER/WARNING/SUGGESTION)
│   ├── kyro-learner/   # Per-project rule accumulation
│   ├── kyro-metrics/   # Velocity trends and debt heatmap
│   ├── kyro-handoff/   # Enriched context transfer
│   └── deslop/           # AI slop detection and removal
├── .claude-plugin/   # Plugin packaging for Claude Code
│   ├── plugin.json   # Plugin manifest (version must match package.json)
│   ├── marketplace.json # Marketplace listing metadata
│   ├── settings.json # Default permissions
│   └── README.md     # Installation instructions
├── docs/             # 8 documentation guides
├── config.json       # Workflow configuration
├── package.json      # NPM package definition
└── WORKFLOW.yaml     # Workflow definition (version must match package.json)
```

## Key Conventions

- **Rules file**: `.agents/kyro-workflow/rules.md` — persistent learned rules for this project
- **Database**: `.agents/kyro-workflow/data.db` — session stats and searchable learnings
- **Sprint output**: `{cwd}/.agents/kyro-workflow/sprint-forge/{project}/` — per-project sprint documents
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

## Plugin Metadata

Plugin metadata lives in the `.claude-plugin/` directory. When updating version, description, or capabilities, keep these files in sync:

- `package.json` — canonical version and description
- `.claude-plugin/plugin.json` — plugin manifest (version must match package.json)
- `.claude-plugin/marketplace.json` — marketplace listing (hook/agent/command/skill counts)
- `WORKFLOW.yaml` — human-readable workflow definition (version, hooks list)
