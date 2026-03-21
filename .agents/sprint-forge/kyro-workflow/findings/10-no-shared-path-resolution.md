---
title: "Finding: No shared path resolution utility across hook scripts"
date: "2026-03-10"
project: "kyro-workflow"
type: "analysis"
status: "active"
severity: "medium"
category: "fragile-pattern"
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

# Finding: No shared path resolution utility across hook scripts

## Summary

Every hook script independently constructs paths to `.agents/kyro-workflow/`, `.active-session`, `rules.md`, sprint directories, etc. There is no shared module. Each script has its own inline path construction, leading to the path bugs documented in finding 02 and making future path changes require editing 11+ files.

## Severity / Impact

medium -- This is the root cause of finding 02 (wrong sprint paths). Without a shared module, any path change requires updating every script individually, and inconsistencies are inevitable.

## Details

Pattern seen across all scripts:
```js
const kyroDir = path.join(process.cwd(), '.agents', 'kyro-workflow');
const sessionFile = path.join(kyroDir, '.active-session');
const rulesPath = path.join(kyroDir, 'rules.md');
```

Each script duplicates this. Some scripts have additional path logic that diverges (e.g., session-start.js tries to auto-discover project dirs, while drift-detector.js hardcodes the sprints path).

11 hook scripts, each with independent path resolution.

## Affected Files

- `scripts/session-start.js`
- `scripts/session-end.js`
- `scripts/quality-gate.js`
- `scripts/post-edit-check.js`
- `scripts/task-complete.js`
- `scripts/drift-detector.js`
- `scripts/learn-capture.js`
- `scripts/rule-checker.js`
- `scripts/context-warning.js`
- `scripts/session-check.js`

## Recommendations

1. Create `scripts/lib/paths.js` with shared path resolution functions
2. Export: `getKyroDir()`, `getActiveSessionPath()`, `getRulesPath()`, `findActiveProject()`, `getSprintsDir(project)`
3. Refactor all scripts to use the shared module
