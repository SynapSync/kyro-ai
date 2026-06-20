---
title: "00-p0-reproducibility-and-ci — Working Project"
date: "2026-06-19"
updated: "2026-06-19"
scope: "00-p0-reproducibility-and-ci"
type: "progress"
status: "active"
version: "1.0"
agents:
  - "codex"
tags:
  - "00-p0-reproducibility-and-ci"
  - "progress"
  - "kyro-ai"
  - "reproducibility"
changelog:
  - version: "1.0"
    date: "2026-06-19"
    changes: ["Project initialized from strategic audit backlog"]
related:
  - "[[ROADMAP]]"
  - "[[RE-ENTRY-PROMPTS]]"
---

# 00-p0-reproducibility-and-ci — Working Project

> Type: audit
> Created: 2026-06-19
> Codebase: `/Users/rperaza/joicodev/projects/synapsync/kyro/kyro-ai`
> Source backlog: `.agents/kyro/strategic-audit-2026-06-19/backlogs/00-p0-reproducibility-and-ci.md`

This directory stores Kyro artifacts for the P0 reproducibility and CI scope. Use structured summaries first; open Markdown only when a router needs durable evidence.

## Quick Resume

1. Read `state.json`.
2. Read `index.json`.
3. Read `ROADMAP.summary.json`.
4. Run `kyro-forge 00-p0-reproducibility-and-ci` to plan Sprint 1.

## Paths

| Resource | Path |
|----------|------|
| Codebase | `/Users/rperaza/joicodev/projects/synapsync/kyro/kyro-ai` |
| Working Directory | `.agents/kyro/scopes/00-p0-reproducibility-and-ci` |
| Findings | `.agents/kyro/scopes/00-p0-reproducibility-and-ci/findings/` |
| Sprints | `.agents/kyro/scopes/00-p0-reproducibility-and-ci/phases/` |
| Roadmap | `.agents/kyro/scopes/00-p0-reproducibility-and-ci/ROADMAP.md` |
| Re-entry | `.agents/kyro/scopes/00-p0-reproducibility-and-ci/RE-ENTRY-PROMPTS.md` |
| Source Audit | `.agents/kyro/strategic-audit-2026-06-19/` |

## Current State

| Metric | Value |
|--------|-------|
| Work type | audit |
| Planned sprints | 3 |
| Active sprint | None |
| Next action | plan_sprint |

## Sprint Map

| Sprint | Status | Focus | Proof |
|--------|--------|-------|-------|
| 1 | pending | Restore generated runtime parity | Sprint 1 isolates REP-001 so reviewers can verify generated runtime parity without also reviewing new CI or docs behavior. |
| 2 | pending | Enforce freshness and adapter CI gates | Sprint 2 groups REP-002, REP-003, and REP-004 because all enforce reproducibility through package scripts and CI gates. |
| 3 | pending | Document generated artifact and release policy | Sprint 3 covers REP-005 because generated artifact policy and release docs should follow the technical gates they document. |
