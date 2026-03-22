# Kyro Analyzer — Codebase Analysis Strategies

## Purpose

Provides the orchestrator with structured analysis strategies based on work type classification during the analysis phase. This is the knowledge base that powers INIT mode's deep analysis.

## Work Type Detection

| Type | Signals | Analysis Focus |
|------|---------|----------------|
| **Audit/Refactor** | "audit", "refactor", "improve", "clean up" | Architecture, patterns, anti-patterns, debt |
| **New Feature** | "add", "implement", "build", "create" | Integration points, existing patterns, dependencies |
| **Bugfix** | "fix", "bug", "broken", "error", "not working" | Error reproduction, related code paths, recent changes |
| **New Project** | "start", "bootstrap", "scaffold", "new project" | Requirements, tech stack, project structure |
| **Tech Debt** | "debt", "TODO", "deprecated", "legacy" | Debt inventory, priority, effort estimation |

## Analysis Strategy per Type

### Audit/Refactor
1. Map project structure (directories, entry points, config files)
2. Identify architecture pattern (MVC, Clean, Hexagonal, etc.)
3. Check test coverage and quality
4. Scan for anti-patterns (god files, circular dependencies, deep nesting)
5. Review dependency health (outdated, vulnerable, unused)
6. Identify code duplication hotspots

### New Feature
1. Understand existing architecture and conventions
2. Find similar features already implemented (patterns to follow)
3. Map integration points (where the new feature touches existing code)
4. Check test patterns for similar features
5. Identify potential conflicts with in-progress work

### Bugfix
1. Reproduce or understand the error
2. Trace the error through the call stack
3. Check git blame for recent changes to affected files
4. Search for similar bugs or related issues
5. Identify the minimal set of files involved

### New Project
1. Clarify requirements and constraints
2. Evaluate tech stack choices
3. Define project structure and conventions
4. Identify initial dependency set
5. Plan CI/CD and deployment approach

### Tech Debt
1. Inventory all TODOs, FIXMEs, HACKs in codebase
2. Check for deprecated API usage
3. Identify untested code paths
4. Map technical debt to business risk
5. Prioritize by effort vs. impact

## Finding Output Format

Each finding becomes a numbered file in `{output_kyro_dir}/findings/`:

```markdown
---
title: "[Finding Title]"
date: YYYY-MM-DD
project: "{project_name}"
type: finding
status: open
severity: critical|high|medium|low
tags: [architecture, security, performance, quality, debt]
---

# [Finding Title]

## Summary
[1-2 sentence description]

## Evidence
[Code snippets, file paths, metrics that support this finding]

## Impact
[What happens if this is not addressed]

## Recommendation
[Specific action to take, with estimated effort]
```
