---
title: "Harness Parity"
date: "2026-06-11"
scope: "kyro-modernization"
type: "finding"
status: "addressed"
tags:
  - "harness-parity"
  - "multi-agent"
  - "portability"
---

# Finding — Harness Parity

## Problem

Kyro is designed as an agent-agnostic workflow kit, but packaging and documentation leaned Claude-first:

- `getting-started.md` listed Claude Code before generic setup
- `docs/agents-reference.md` hardcoded `opus` as the orchestrator model
- `contexts/*.md` included `model: opus`
- Scripts used `CLAUDE_*` env var names without generic aliases
- No explicit `config.json` harness capabilities
- No copy-and-customize templates for Cursor or Kilo Code
- Parallelism and QA isolation relied on implicit “if harness supports subagents” prose

## Evidence

| Location | Issue |
|----------|-------|
| `docs/getting-started.md` | Claude adapter first |
| `docs/agents-reference.md` | Model column: `opus` |
| `contexts/init.md`, `sprint.md`, `review.md` | `model: opus` in frontmatter |
| `scripts/lib/workflow-utils.js` | Only `CLAUDE_PROJECT_DIR` |
| `config.json` | No `harness` section |
| `adapters/` | Missing |

## Success Criteria

1. Generic setup is the primary installation path in docs
2. Core files do not prescribe model or provider
3. `KYRO_*` env vars work with `CLAUDE_*` aliases
4. `config.harness` drives subagent and enforcement behavior
5. `adapters/` ships templates for Cursor, generic, Kilo Code, Claude pointer
6. Evals assert portability invariants (12+ scenarios)

## Recommendation

Sprint 8 — Harness Parity: neutralize core, add harness config, ship adapter templates, extend evals, bump to 3.10.0.
