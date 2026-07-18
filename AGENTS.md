# Kyro — Workflow

## Overview

Kyro is a **workflow** (not a standalone skill) that orchestrates sprint-based project execution through one orchestrator agent, built-in checkpoints, and persistent learning.

## Architecture: Command → Agent → Skill

```
User Command (/kyro:forge, /kyro:status, /kyro:task-context, /kyro:qa, /kyro:idea)
  └── Agent (orchestrator, or direct skill load for qa and idea)
        └── Skill (core)
```

## Directory Structure

```
kyro-ai/
├── agents/           # 1 agent
│   ├── orchestrator.md # Full cycle coordinator — handles analysis, review, debugging, and sprint execution
├── commands/         # 5 slash commands
│   ├── forge.md      # /kyro:forge — full cycle with gates
│   ├── status.md     # /kyro:status — progress and debt summary
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
   - Change `"description": "..."` when release positioning changes

2. **Sync version-bearing files:**
   - `package-lock.json` — update the root package version entries
   - `.claude-plugin/plugin.json` — update `"version"`
   - `WORKFLOW.yaml` — update `version:`

3. **Sync release-facing docs/metadata when behavior changed:**
   - `CHANGELOG.md` — add the new version section under `Unreleased`
   - `.claude-plugin/marketplace.json` — update descriptions only when capabilities/positioning changed
   - `AGENTS.md` / `docs/*` — update workflow guidance that release users or agents rely on

4. **Compile and verify:**
   ```bash
   OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf npm_config_cache=/tmp/kyro-ai-npm-cache npm_config_script_shell=/bin/zsh npm run build
   OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf npm_config_cache=/tmp/kyro-ai-npm-cache npm_config_script_shell=/bin/zsh npm run check
   npm pack --dry-run  # verify tarball contents
   ```

5. **Commit with Conventional Commits:**
   - Feature release: `feat(<scope>): ...` may include code, docs, tests, and the version bump when they are one reviewable release unit
   - Version-only release prep: `chore: bump version to X.Y.Z`
   - Never include `Co-Authored-By` or AI attribution

⚠️ **Important:** Version files must stay in sync. Mismatched versions will cause installation and release issues.

<!-- kyro-ai:agents-md:start -->
## Kyro AI

Use installed Kyro command skills: `kyro-forge`, `kyro-status`, `kyro-task-context`, `kyro-qa`, `kyro-idea`.

Runtime: `~/.agents/kyro/current/`
Project state: `.agents/kyro/kyro.json`
Artifacts: `.agents/kyro/scopes/{scope}/`
Skills: `~/.agents/skills/kyro-*`

Load command routers only when a Kyro skill is invoked. Do not load full Kyro docs unless the router asks for them. Preserve non-Kyro content; Kyro owns only this marked block.
<!-- kyro-ai:agents-md:end -->


<claude-mem-context>
# Memory Context

# [kyro-ai] recent context, 2026-07-15 11:39am EDT

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 8 obs (2,759t read) | 50,272t work | 95% savings

### Jul 11, 2026
S1010 User inquiry about QA certification in Kyro evolved into complete feature implementation, audit, remediation, version release, and validation of standalone /kyro:qa command through version 4.17.0 (Jul 11 at 2:51 AM)
S1011 Build failure investigation and fix for missing qa command skill in standard adapter (Jul 11 at 2:55 AM)
S1012 Fix build failure caused by missing qa command in CLI generation system and complete /kyro:qa adapter integration (Jul 11 at 3:06 AM)
### Jul 13, 2026
2677 8:07a 🔵 Archived snapshots exclude project-level artifacts
2678 " 🔵 Sprint close checkpoints contain full sprint.json state transitions
2679 8:08a 🔵 Sprint close checkpoints preserve complete project state including all artifacts
2680 " 🔵 SprintFile structure contains all project-level artifacts in archived checkpoints
2681 8:09a ✅ Enhanced checkpoint validation tests to verify complete artifact preservation
2682 " 🔵 Lossless checkpoint validation script uses check:lossless-checkpoints name
2683 " ✅ Validated checkpoint structure preserves all project artifacts in test suite
2733 2:20p 🔵 Command syntax confusion between kyro status and /kyro:status

Access 50k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>