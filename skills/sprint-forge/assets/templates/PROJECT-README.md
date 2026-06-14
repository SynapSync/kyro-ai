---
title: "{scope} — Working Project"
date: "{date}"
updated: "{date}"
scope: "{scope}"
type: "progress"
status: "active"
version: "1.0"
agents:
  - "{agent_model}"
tags:
  - "{scope}"
  - "progress"
  - "kyro-ai"
changelog:
  - version: "1.0"
    date: "{date}"
    changes: ["Project initialized"]
related:
  - "[[ROADMAP]]"
  - "[[RE-ENTRY-PROMPTS]]"
---

# {scope} — Working Project

> Type: {work_type}
> Created: {date}
> Codebase: `{codebase_path}`

This directory stores Kyro artifacts for `{scope}`. Use structured summaries first; open Markdown only when a router needs durable evidence.

## Quick Resume

1. Read `state.json`.
2. Read `index.json`.
3. Read `ROADMAP.summary.json`.
4. Run `kyro-forge`, `kyro-status`, or `kyro-wrap-up`.

## Paths

| Resource | Path |
|----------|------|
| Codebase | `{codebase_path}` |
| Working Directory | `{output_kyro_dir}` |
| Findings | `{output_kyro_dir}/findings/` |
| Sprints | `{output_kyro_dir}/phases/` |
| Roadmap | `{output_kyro_dir}/ROADMAP.md` |
| Re-entry | `{output_kyro_dir}/RE-ENTRY-PROMPTS.md` |

## Current State

| Metric | Value |
|--------|-------|
| Work type | {work_type} |
| Planned sprints | {planned_sprint_count} |
| Active sprint | {active_sprint} |
| Next action | {next_action} |

## Sprint Map

| Sprint | Status | Focus | Proof |
|--------|--------|-------|-------|
| 1 | {status} | {focus} | {sprint_proof} |
