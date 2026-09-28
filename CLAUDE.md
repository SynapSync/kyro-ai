# Kyro — Workflow

## Overview

Kyro is a **workflow** (not a standalone skill) with separate Forge and Work paths, CLI-owned state, built-in checkpoints, and persistent learning.

## Architecture: Command → Agent → Skill

```
User Command (/kyro-forge, /kyro-status, /kyro-work, and other native skills)
  └── Projected command skill
        └── Canonical runtime router
              └── Routed workflow engine
```

## Directory Structure

```
kyro-ai/
├── agents/           # 1 agent
│   ├── orchestrator.md # Full cycle coordinator — handles analysis, review, debugging, and sprint execution
├── commands/         # 7 canonical command routers
│   ├── forge.md      # /kyro:forge — full cycle with gates
│   ├── status.md     # /kyro:status — progress and debt summary
│   ├── idea.md       # /kyro:idea — idea maturation pre-scope (optional)
│   ├── qa.md         # /kyro:qa — certification and quality audit (independent)
│   ├── task-context.md # /kyro:task-context — fresh-context continuation prompt
│   ├── scope-retire.md # /kyro:scope-retire — human-gated obsolete-scope retirement
│   └── work.md      # /kyro:work — explicitly selected Work lifecycle
├── internal/skills/  # workflow engines; not public Claude commands
│   ├── sprint-forge/      # Core orchestration — modes, helpers (analyzer, reviewer, learner, metrics, handoff), templates
│   ├── seedbed/           # Idea maturation pre-scope — matures a rough idea into a structured brief (loaded only via /kyro:idea)
│   ├── qa-review/         # Senior QA auditor — code review, architecture validation, security audit, sprint-forge verification
│   ├── kyro-sprint-executor/ # Strict standalone sprint executor for external hosts — projected to agent skill roots on install/sync
│   └── organic-work/ # Explicitly selected Work lifecycle
├── src/cli/adapters/claude.ts # CLI-managed Claude skill projection
├── docs/             # User, developer, and release guides
├── config.json       # Workflow configuration
├── package.json      # NPM package definition
└── WORKFLOW.yaml     # Workflow definition (version must match package.json)
```

## Key Conventions

- **Rules file**: `.agents/kyro/scopes/rules.md` — persistent learned rules for this project
- **Sprint output**: `{cwd}/.agents/kyro/scopes/{scope}/` — per-scope sprint documents (where `{scope}` is the work topic, e.g., `oauth-implementation`, `ui-redesign`)
- **Matured-idea documents**: `.agents/kyro/{docType}/{date}-{slug}.md` — optional pre-scope briefs from `/kyro:idea` (`docType` is one of `plan`, `analysis`, `constitution`). Write-only, never routed. Kept explicitly separate from `project.json.principles[]`.
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

## Release Metadata

Claude Code uses the CLI-managed adapter, not a plugin. When updating version, description, or capabilities, keep these files in sync:

- `package.json` — canonical version and description (source of truth)
- `package-lock.json` — root package version and reproducible dependencies
- `WORKFLOW.yaml` — human-readable workflow definition (version, agents list)

### Version & Description Update Checklist

When bumping version or changing the description:

1. **Update `package.json`** (canonical source)
   - Change `"version": "X.Y.Z"`
   - Change `"description": "..."`

2. **Sync release files** to match:
   - `package-lock.json` — update root package versions
   - `WORKFLOW.yaml` — update `version:` and optionally `description:`
   - `docs/agent-adapters.md` — update migration guidance when behavior changes

3. **Compile and verify:**
   ```bash
   npm run build
   npm pack --dry-run  # verify tarball contents
   ```

4. **Commit with message** containing: "chore: bump version to X.Y.Z" or "docs: update descriptions"

⚠️ **Important:** Package, lockfile, and workflow versions must stay in sync. Mismatches cause installation issues.
