---
title: "Finding: Plugin manifests only partially synchronized"
date: "2026-03-10"
project: "kyro-workflow"
type: "analysis"
status: "active"
severity: "medium"
category: "sync-issue"
agents:
  - "claude-opus-4-6"
tags:
  - "kyro-workflow"
  - "analysis"
  - "finding"
changelog:
  - version: "1.0"
    date: "2026-03-10"
    changes: ["Finding documented"]
related:
  - "[[ROADMAP]]"
---

# Finding: Plugin manifests only partially synchronized

## Summary

CLAUDE.md states ".claude-plugin and .cursor-plugin must be kept in sync" but the two manifests have significantly different structures and content. The .cursor-plugin version is minimal (7 lines) while .claude-plugin is comprehensive (29 lines). Key fields present in .claude-plugin but missing from .cursor-plugin: description detail, author, homepage, repository, license, keywords, agents list.

## Severity / Impact

medium -- If Cursor ever uses these fields for discoverability or agent resolution, the plugin will be degraded. The agents list in .claude-plugin is especially important as it tells the runtime where to find agent definitions.

## Details

**.claude-plugin/plugin.json**:
- Has: name, version, description, author, homepage, repository, license, keywords, skills array, agents array
- Description: "Agentic execution kernel for structured work. 4 agents, 12 hooks, 9 commands, 7 skills, adaptive learning, and formal debt tracking."

**.cursor-plugin/plugin.json**:
- Has: name, version, description, skills array, rules array
- Description: "Agentic execution kernel for structured work. 4 agents, 12 hooks, 9 commands, 7 skills, adaptive learning."
- Missing: author, homepage, repository, license, keywords, agents array
- Extra: `rules` array (not in .claude-plugin)

Also note the descriptions differ slightly -- .claude-plugin mentions "formal debt tracking" while .cursor-plugin does not.

## Affected Files

- `.claude-plugin/plugin.json`
- `.cursor-plugin/plugin.json`

## Recommendations

1. Define a single source of truth (e.g., .claude-plugin/plugin.json) and derive the other
2. Add agents array to .cursor-plugin if Cursor supports it
3. Add rules array to .claude-plugin if Claude Code supports it
4. Ensure descriptions match exactly
