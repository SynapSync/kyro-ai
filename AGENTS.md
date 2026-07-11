# Kyro — Workflow

## Overview

Kyro is a **workflow** (not a standalone skill) that orchestrates sprint-based project execution through one orchestrator agent, built-in checkpoints, and persistent learning.

## Architecture: Command → Agent → Skill

```
User Command (/kyro:forge, /kyro:status, /kyro:wrap-up, /kyro:task-context, /kyro:qa, /kyro:idea)
  └── Agent (orchestrator, or direct skill load for qa and idea)
        └── Skill (core)
```

## Directory Structure

```
kyro-ai/
├── agents/           # 1 agent
│   ├── orchestrator.md # Full cycle coordinator — handles analysis, review, debugging, and sprint execution
├── commands/         # 6 slash commands
│   ├── forge.md      # /kyro:forge — full cycle with gates
│   ├── status.md     # /kyro:status — progress and debt summary
│   ├── wrap-up.md    # /kyro:wrap-up — session closure ritual
│   ├── task-context.md # /kyro:task-context — fresh-context prompt generation
│   ├── idea.md       # /kyro:idea — idea maturation pre-scope (optional)
│   └── qa.md         # /kyro:qa — certification audit (independent)
├── skills/           # 3 skills
│   ├── sprint-forge/      # Core orchestration — modes, helpers (analyzer, reviewer, learner, metrics, handoff), templates
│   ├── seedbed/           # Idea maturation pre-scope — matures a rough idea into a structured brief
│   └── qa-review/         # Senior QA auditor — code review, architecture validation, security audit, sprint-forge verification
├── .claude-plugin/  # Claude Code adapter packaging
│   ├── plugin.json   # Plugin manifest (version must match package.json)
│   ├── marketplace.json # Marketplace listing metadata
│   ├── settings.json # Default permissions
│   └── README.md     # Installation instructions
├── docs/             # 10 markdown guides plus architecture.mmd
├── config.json       # Workflow configuration
├── package.json      # NPM package definition
└── WORKFLOW.yaml     # Workflow definition (version must match package.json)
```

## Key Conventions

- **Rules file**: `.agents/kyro/scopes/rules.md` — persistent learned rules for this project
- **Sprint output**: `{cwd}/.agents/kyro/scopes/{scope}/` — per-scope sprint documents (where `{scope}` is the work topic, e.g., `oauth-implementation`, `ui-redesign`)
- **Checkpoint-per-phase**: Sprint file saved after each phase completes
- **Debt never disappears**: Items are only closed when explicitly resolved
- **Gates require approval**: Never proceed past a validation gate without user confirmation

## Skill Creation Requirements

When creating a new skill, the `SKILL.md` file **MUST** start with YAML frontmatter block. This is required for `npx skills add` to discover and parse the skill:

```yaml
---
name: skill-name
description: One-line description of what the skill does
license: Apache-2.0
metadata:
  author: synapsync
  version: "1.0"
  scope: [root]
---
```

**Why**: The `npx skills add` command relies on parsing the YAML frontmatter to extract the skill's `name` and `description`. Without this block, the skill discovery mechanism fails and the skill will not be detected during installation.

**Every new skill must have**:
- `name:` — kebab-case skill identifier
- `description:` — single-line summary of functionality
- `license:` — typically `Apache-2.0`
- `metadata.author:` — synapsync (or your organization)
- `metadata.version:` — version string (e.g., "1.0")
- `metadata.scope:` — `[root]` for root-level skills

## Development

```bash
npm install
npm run build
```

## Plugin Metadata

Claude Code adapter metadata lives in the `.claude-plugin/` directory. When updating version, description, or capabilities, keep these files in sync:

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

<!-- kyro-ai:agents-md:start -->
## Kyro AI

Use installed Kyro command skills: `kyro-forge`, `kyro-status`, `kyro-wrap-up`, `kyro-task-context`, `kyro-qa`, `kyro-idea`.

Runtime: `~/.agents/kyro/current/`
Project state: `.agents/kyro/kyro.json`
Artifacts: `.agents/kyro/scopes/{scope}/`
Skills: `~/.agents/skills/kyro-*`

Load command routers only when a Kyro skill is invoked. Do not load full Kyro docs unless the router asks for them. Preserve non-Kyro content; Kyro owns only this marked block.
<!-- kyro-ai:agents-md:end -->
