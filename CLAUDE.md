# Kyro — Workflow

## Overview

Kyro is a **workflow** (not a standalone skill) that orchestrates sprint-based project execution through the orchestrator agent, guardian agent, and persistent learning.

## Architecture: Command → Agent → Skill

```
User Command (/kyro-workflow:forge, /kyro-workflow:status, /kyro-workflow:wrap-up)
  └── Agent (orchestrator)
        ├── Skill (sprint-forge)
        └── Agent (guardian — configurable event-based checkpoints)
```

## Directory Structure

```
kyro-workflow/
├── agents/           # 2 agents
│   ├── orchestrator.md # Full cycle coordinator — handles analysis, review, debugging, and sprint execution
│   └── guardian.md     # Event-based checkpoints — configurable lifecycle events (rules loading, drift detection, quality checks)
├── commands/         # 3 slash commands
│   ├── forge.md      # /kyro-workflow:forge — full cycle with gates
│   ├── status.md     # /kyro-workflow:status — metrics and debt heatmap
│   └── wrap-up.md    # /kyro-workflow:wrap-up — session closure ritual
├── skills/           # 1 skill (domain knowledge)
│   └── sprint-forge/      # Core orchestration — modes, helpers (analyzer, reviewer, learner, metrics, handoff), templates
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

- **Rules file**: `.agents/sprint-forge/rules.md` — persistent learned rules for this project
- **Database**: `.agents/sprint-forge/data.db` — session stats and searchable learnings
- **Sprint output**: `{cwd}/.agents/sprint-forge/{scope}/` — per-scope sprint documents (where `{scope}` is the work topic, e.g., `oauth-implementation`, `ui-redesign`)
- **Checkpoint-per-phase**: Sprint file saved after each phase completes
- **Debt never disappears**: Items are only closed when explicitly resolved
- **Gates require approval**: Never proceed past a validation gate without user confirmation

## Development

```bash
npm install
npm run build
```

## Plugin Metadata

Plugin metadata lives in the `.claude-plugin/` directory. When updating version, description, or capabilities, keep these files in sync:

- `package.json` — canonical version and description (source of truth)
- `.claude-plugin/plugin.json` — plugin manifest (version must match package.json)
- `.claude-plugin/marketplace.json` — marketplace listing (description and agent/command/skill counts)
- `WORKFLOW.yaml` — human-readable workflow definition (version, agents list)

### Version & Description Update Checklist

When bumping version or changing the description:

1. **Update `package.json`** (canonical source)
   - Change `"version": "X.Y.Z"`
   - Change `"description": "..."`

2. **Sync 3 other files** to match:
   - `.claude-plugin/plugin.json` — update `"version"`
   - `.claude-plugin/marketplace.json` — update `"description"`
   - `WORKFLOW.yaml` — update `version:` and optionally `description:`

3. **Compile and verify:**
   ```bash
   npm run build
   npm pack --dry-run  # verify tarball contents
   ```

4. **Commit with message** containing: "chore: bump version to X.Y.Z" or "docs: update descriptions"

⚠️ **Important:** All 4 files must be kept in sync. Mismatched versions will cause installation issues.
