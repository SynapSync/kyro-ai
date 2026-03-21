---
title: "Finding: Race condition and missing validation in .active-session file"
date: "2026-03-10"
project: "kyro-workflow"
type: "analysis"
status: "active"
severity: "medium"
category: "missing-validation"
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

# Finding: Race condition and missing validation in .active-session file

## Summary

Multiple hooks read and write `.agents/kyro-workflow/.active-session` concurrently without any locking or atomic write mechanism. quality-gate.js, learn-capture.js, and task-complete.js all do `read -> modify -> write` on this file. If two hooks fire in quick succession, one write can clobber the other's changes.

## Severity / Impact

medium -- In practice, Claude Code hooks may run sequentially, but the code has no guarantee of this. Session stats (edit_count, tasks_completed, corrections_count) can be lost or double-counted.

## Details

Pattern in quality-gate.js, learn-capture.js, task-complete.js:
```js
const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
sessionData.edit_count = (sessionData.edit_count || 0) + 1;
fs.writeFileSync(sessionFile, JSON.stringify(sessionData));
```

No file locking, no atomic rename, no validation of the JSON structure.

Additionally, session-end.js calls `fs.unlinkSync(sessionFile)` to remove the file. If any hook fires between the read and unlink, it will fail.

## Affected Files

- `scripts/quality-gate.js:30-37`
- `scripts/learn-capture.js:99-106`
- `scripts/task-complete.js:23-31`
- `scripts/session-end.js:33`

## Recommendations

1. Use atomic file writes (write to temp file, then rename)
2. Or use the SQLite database (already available) to store session state instead of a JSON file
3. Add JSON schema validation when reading the file
