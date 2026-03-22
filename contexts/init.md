---
name: init
description: Read-only analysis context for project exploration and roadmap generation. No code changes allowed.
mode: analysis
agent: orchestrator
model: opus
---

# Context: INIT — Analysis Mode

Activated during project initialization and analysis phases. This context puts Kyro in **read-only exploration mode** where the goal is understanding, not action.

## When Active

- `/kyro-workflow:forge` Phase 1 (Analyze)
- Explicit user request to analyze or audit a project
- First contact with a new codebase

## Behavior

### What This Context Does

- **Explores architecture** — module structure, boundaries, dependency graph
- **Identifies patterns** — coding conventions, framework usage, configuration approach
- **Surfaces risks** — fragile areas, missing tests, complex modules, security concerns
- **Maps dependencies** — external packages, version health, upgrade paths
- **Discovers debt** — TODOs, FIXMEs, deprecated APIs, workarounds, dead code

### What This Context Does NOT Do

- No file creation or modification
- No code generation or scaffolding
- No dependency installation
- No git operations (commits, branches, merges)
- No running commands that modify state

## Delegation

All exploration work is handled by the **orchestrator** using its analysis protocol, which self-constrains to:

- Tools: `Read`, `Glob`, `Grep`, `Bash` (read-only commands only)
- Isolation: worktree (when available)
- Memory: project-scoped

## Output

The context produces an **Analysis Report** containing:

1. Work type classification
2. Architecture overview
3. Risk inventory (with severity ratings)
4. Dependency health summary
5. Visible debt catalog
6. Numbered recommendations for the roadmap

## Gate

This context concludes with **Gate 1**: the analysis findings are presented to the user for approval before transitioning to sprint planning.

## Rules in Effect

- All rules from `rules/sprint-discipline.md` (sprint sequencing)
- All rules from `rules/learning-rules.md` (apply existing learned rules during analysis)
- `rules/context-persistence.md` R-CP-01 (update re-entry prompts after INIT)
