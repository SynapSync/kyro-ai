---
title: "Finding: WORKFLOW.yaml version desync"
date: "2026-03-10"
project: "kyro-workflow"
type: "analysis"
status: "active"
severity: "high"
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

# Finding: WORKFLOW.yaml version desync

## Summary

WORKFLOW.yaml declares `version: "2.3.0"` while package.json and both plugin manifests (.claude-plugin/plugin.json, .cursor-plugin/plugin.json) declare `version: "2.8.0"`. This creates confusion about which version is canonical.

## Severity / Impact

high -- The WORKFLOW.yaml is the human-readable manifest of the workflow. A stale version number means external tooling or documentation referencing it will report the wrong version. It also signals that WORKFLOW.yaml is not updated as part of the release process.

## Details

- `package.json` -> `"version": "2.8.0"`
- `.claude-plugin/plugin.json` -> `"version": "2.8.0"`
- `.cursor-plugin/plugin.json` -> `"version": "2.8.0"`
- `WORKFLOW.yaml` -> `version: "2.3.0"` (5 minor versions behind)

The git log shows: `ec9f958 Bump version to 2.8.0` -- this commit likely updated package.json and plugin manifests but missed WORKFLOW.yaml.

## Affected Files

- `WORKFLOW.yaml:3`
- `package.json:3`

## Recommendations

1. Update WORKFLOW.yaml version to 2.8.0
2. Add WORKFLOW.yaml to the version bump checklist or script to prevent future desync
