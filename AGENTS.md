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


<claude-mem-context>
# Memory Context

# [kyro-ai] recent context, 2026-07-13 2:44pm EDT

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (23,589t read) | 232,057t work | 90% savings

### Jul 9, 2026
S1001 Guidance on starting a new microservice project with Kyro from scratch (Jul 9 at 11:34 PM)
### Jul 10, 2026
S1003 User requested complete Kyro context documentation to supplement previous explanation (Jul 10 at 1:30 PM)
### Jul 11, 2026
S1005 User inquired about QA certification, validation, and code quality capabilities in Kyro to verify development work meets requirements (Jul 11 at 2:17 AM)
S1006 User inquiry about QA certification and validation capabilities led to discovery of gap in Kyro's standalone QA tooling (Jul 11 at 2:33 AM)
S1007 User requested QA certification capability to validate development work against requirements; gap identified and new standalone command implemented (Jul 11 at 2:33 AM)
S1008 User inquiry about QA certification and code quality validation capabilities in Kyro led to discovery, implementation, audit, and complete remediation of standalone /kyro:qa command (Jul 11 at 2:36 AM)
S1009 User inquiry about QA certification and code quality validation in Kyro evolved into complete feature implementation, audit, remediation, and release preparation of standalone /kyro:qa command (Jul 11 at 2:49 AM)
S1010 User inquiry about QA certification in Kyro evolved into complete feature implementation, audit, remediation, version release, and validation of standalone /kyro:qa command through version 4.17.0 (Jul 11 at 2:51 AM)
S1011 Build failure investigation and fix for missing qa command skill in standard adapter (Jul 11 at 2:55 AM)
S1012 Fix build failure caused by missing qa command in CLI generation system and complete /kyro:qa adapter integration (Jul 11 at 3:06 AM)
### Jul 13, 2026
2635 3:33a 🔵 Archived sprint snapshots exclude project-level artifacts
2636 " ⚖️ Beginning implementation of versioned full-scope sprint checkpoints
2637 3:34a ✅ Delegated lossless checkpoint implementation to subagent
2638 " ✅ Subagent loaded implementation toolchain and project context
2639 " 🔵 Subagent mapped implementation surface for checkpoint feature
2640 3:35a 🔵 Subagent read current close-sprint implementation and validation surface
2641 " 🔵 Subagent mapped pipeline orchestrator and rollback mechanics
2642 3:36a 🔵 Subagent audited zero-loss archive contract and test coverage
2643 " 🟣 Implemented type foundation for versioned full-scope sprint checkpoints
2644 3:38a 🟣 Implemented durable checkpoint transaction engine with atomic publish and compare-and-swap
2645 " 🟣 Integrated checkpoint transaction engine into close-sprint command
2646 3:39a 🟣 Extended checkpoint transaction system to MCP close_sprint tool
2647 " 🟣 Implemented checkpoint audit and recovery classification in artifact doctor
2648 3:40a 🔴 Enhanced checkpoint validation with legacy snapshot digest and ledger path verification
2649 " 🔴 Fixed TypeScript type safety in checkpoint ledger path validation
2650 " 🟣 Extended checkpoint validation to verify ledger checkpoint field
2651 " 🔴 Build succeeded but MCP test detected double-close behavior change
2652 3:41a 🔵 Manual checkpoint integration test hit fixture setup issues
2653 " 🟣 Validated checkpoint transaction system with successful manual integration test
2654 " 🔵 Audited documentation surface for checkpoint feature updates
2655 3:42a ✅ Updated documentation to reflect lossless scope checkpoint terminology and semantics
2656 " ✅ Updated sprint-forge skill documentation for checkpoint-based close and recovery workflows
2657 " ✅ Added comprehensive checkpoint feature documentation for developers and consumers
2658 3:43a 🔵 Audited version metadata and changelog structure for checkpoint feature release
2659 " 🔵 Reviewed comprehensive test and build infrastructure for checkpoint feature validation
2660 " ✅ Released version 4.19.0 with lossless checkpoint feature documented in changelog
2661 " 🔴 Fixed MCP integration test to expect idempotent checkpoint resume instead of double-close error
2662 3:44a 🔵 Examined close-sprint-happy test fixture structure
2663 3:45a 🟣 Implemented comprehensive lossless checkpoint integration test suite
2664 " 🟣 Successfully validated lossless checkpoint implementation with comprehensive test suite
2665 " 🟣 Enhanced checkpoint test suite with doctor state classification validation
2666 " 🟣 Strengthened checkpoint validation with identity-based path and timestamp consistency checks
2667 3:46a 🟣 Lossless checkpoint feature fully validated across all integration test suites
2668 " 🔴 Identified 2 eval test fixtures needing updates for checkpoint terminology and ledger schema
2669 " 🔴 Fixed eval test fixtures to match checkpoint terminology and ledger schema
2670 3:47a 🟣 Checkpoint feature passed comprehensive quality gate across all behavioral and invariant test suites
2671 " 🟣 Checkpoint feature ready for commit with 418 net additions across 26 files
2672 " 🔵 Identified 6 additional files with legacy zero-loss terminology
2673 " 🔴 Completed terminology updates across documentation and removed unused sprint variable
2674 3:48a 🔴 Completed full terminology migration from zero-loss to lossless across entire codebase
2675 " 🔴 Strengthened checkpoint path validation to require exact canonical structure
2676 " ✅ Added sprint-close checkpoints documentation to README navigation
2677 8:07a 🔵 Archived snapshots exclude project-level artifacts
2678 " 🔵 Sprint close checkpoints contain full sprint.json state transitions
2679 8:08a 🔵 Sprint close checkpoints preserve complete project state including all artifacts
2680 " 🔵 SprintFile structure contains all project-level artifacts in archived checkpoints
2681 8:09a ✅ Enhanced checkpoint validation tests to verify complete artifact preservation
2682 " 🔵 Lossless checkpoint validation script uses check:lossless-checkpoints name
2683 " ✅ Validated checkpoint structure preserves all project artifacts in test suite
2733 2:20p 🔵 Command syntax confusion between kyro status and /kyro:status

Access 232k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>