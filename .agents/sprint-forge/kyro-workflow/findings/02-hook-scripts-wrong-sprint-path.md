---
title: "Finding: Hook scripts look for sprints at wrong path"
date: "2026-03-10"
project: "kyro-workflow"
type: "analysis"
status: "active"
severity: "critical"
category: "bug"
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

# Finding: Hook scripts look for sprints at wrong path

## Summary

Multiple hook scripts (drift-detector.js, session-check.js, session-start.js) scan for sprint files at `.agents/kyro-workflow/sprints/` but the actual sprint storage path is `.agents/kyro-workflow/sprint-forge/{project}/sprints/`. This means drift detection, session checks, and active sprint detection silently fail in all cases.

## Severity / Impact

critical -- These hooks are central to the workflow's runtime behavior. Drift detection never fires, session-check never detects active sprints, and session-start never reports the active sprint. The workflow appears to work but is running blind.

## Details

**drift-detector.js (lines 13-16)**:
```js
const kyroDir = path.join(process.cwd(), '.agents', 'kyro-workflow');
const sprintsDir = path.join(kyroDir, 'sprints');
```
Looks for sprints directly under `.agents/kyro-workflow/sprints/` -- this directory never exists.

**session-check.js (lines 6-8)**:
```js
const kyroDir = path.join(process.cwd(), '.agents', 'kyro-workflow');
const sprintsDir = path.join(kyroDir, 'sprints');
```
Same wrong path.

**session-start.js (lines 31-46)**:
Scans `.agents/kyro-workflow/` for subdirectories (excluding 'sprints'), then looks inside the first found directory for a `sprints/` subfolder. This is closer to correct but fragile -- it picks the first alphabetical directory, not necessarily the active project.

**context-warning.js (line 12)**:
```js
const reentryPath = path.join(kyroDir, 'RE-ENTRY-PROMPTS.md');
```
Looks for RE-ENTRY-PROMPTS.md directly in `.agents/kyro-workflow/` but it is stored at `.agents/kyro-workflow/sprint-forge/{project}/RE-ENTRY-PROMPTS.md`.

**Correct path**: `.agents/kyro-workflow/sprint-forge/{project}/sprints/`

## Affected Files

- `scripts/drift-detector.js:13-16`
- `scripts/session-check.js:6-8`
- `scripts/session-start.js:31-46`
- `scripts/context-warning.js:12`

## Recommendations

1. All scripts need to scan `.agents/kyro-workflow/sprint-forge/*/sprints/` to find sprint files
2. Extract a shared utility function `findActiveProject()` that all hooks can use
3. Store the active project name in `.active-session` so hooks can resolve the correct path
