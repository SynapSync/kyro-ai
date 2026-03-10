---
title: "Finding: Pervasive silent failure pattern in hook scripts"
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

# Finding: Pervasive silent failure pattern in hook scripts

## Summary

Nearly every hook script wraps its core logic in `try { ... } catch (e) { /* silently pass through */ }`. This means bugs in hooks are invisible -- they fail silently and the user never knows a feature is broken. Combined with finding 02 (wrong paths), this means the drift detector, session check, and context warning have likely never worked without anyone noticing.

## Severity / Impact

medium -- Silent failures make the workflow appear healthy when critical features are broken. This is especially dangerous for hooks that the user relies on (drift detection, quality reminders).

## Details

Examples of silent catch blocks:

**drift-detector.js**: `catch (e) { // Silently pass through }`
**rule-checker.js**: `catch (e) { // Silently pass through }`
**post-edit-check.js**: `catch (e) { // Silently pass through on parse error }`
**learn-capture.js**: `catch (e) { // Silently pass through on error }`
**session-start.js**: `catch (e) { console.error('[Kyro] DB init skipped: ' + e.message); }` (this one at least logs)

The rationale is understandable -- hooks must not block the user's workflow. But there should be a debug mode or log file.

## Affected Files

- All 11 scripts in `scripts/`

## Recommendations

1. Add a `KYRO_DEBUG` environment variable. When set, log errors to stderr
2. Or write errors to `.agents/kyro-workflow/hook-errors.log` for post-session inspection
3. At minimum, change `// Silently pass through` to `console.error('[Kyro:debug] ' + e.message)` behind a debug flag
