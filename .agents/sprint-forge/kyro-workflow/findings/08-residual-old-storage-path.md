---
title: "Finding: Residual .agents/kyro/ directory from old path scheme"
date: "2026-03-10"
project: "kyro-workflow"
type: "analysis"
status: "active"
severity: "low"
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

# Finding: Residual .agents/kyro/ directory from old path scheme

## Summary

An empty `.agents/kyro/` directory exists alongside the current `.agents/kyro-workflow/` directory. Commit `de0d0b0` renamed storage paths from `.agents/kyro/` to `.agents/kyro-workflow/` but the old directory was not removed. No code references `.agents/kyro/` anymore (verified via grep), so this is just leftover cruft.

## Severity / Impact

low -- No runtime impact, but it can confuse contributors exploring the directory structure. The git history shows this was an intentional rename.

## Details

- `.agents/kyro/` -- empty directory, no files
- `.agents/kyro-workflow/` -- active storage path (currently empty except for .gitignore)
- All code references use `.agents/kyro-workflow/`

## Affected Files

- `.agents/kyro/` (should be removed)

## Recommendations

1. Remove the empty `.agents/kyro/` directory
2. Add it to .gitignore if needed for backward compatibility
