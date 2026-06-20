---
title: "00-p0-reproducibility-and-ci — Re-entry Prompts"
date: "2026-06-19"
updated: "2026-06-19"
scope: "00-p0-reproducibility-and-ci"
type: "execution-plan"
status: "completed"
version: "1.0"
agents:
  - "codex"
tags:
  - "00-p0-reproducibility-and-ci"
  - "execution-plan"
  - "reentry"
  - "kyro-ai"
changelog:
  - version: "1.0"
    date: "2026-06-19"
    changes: ["Re-entry prompts created"]
related:
  - "[[README]]"
  - "[[ROADMAP]]"
---

# 00-p0-reproducibility-and-ci — Re-entry Prompts

> Last updated: 2026-06-20
> Current sprint: none active; scope completed
> Latest handoff: `handoffs/2026-06-20-scope-wrap-up.md`

Use these prompts to resume through summary-first routing. Open long Markdown only when a router asks for it.

## Fast Context

| Resource | Path |
|----------|------|
| State | `.agents/kyro/scopes/00-p0-reproducibility-and-ci/state.json` |
| Index | `.agents/kyro/scopes/00-p0-reproducibility-and-ci/index.json` |
| Roadmap Summary | `.agents/kyro/scopes/00-p0-reproducibility-and-ci/ROADMAP.summary.json` |
| Sprints | `.agents/kyro/scopes/00-p0-reproducibility-and-ci/phases/` |
| Source Backlog | `.agents/kyro/strategic-audit-2026-06-19/backlogs/00-p0-reproducibility-and-ci.md` |

## Sprint Quick Reference

| Sprint | File | Status |
|--------|------|--------|
| 1 | `phases/SPRINT-001-restore-generated-runtime-parity.md` | completed |
| 2 | `phases/SPRINT-002-enforce-freshness-and-adapter-ci-gates.md` | completed |
| 3 | `phases/SPRINT-003-document-generated-artifact-and-release-policy.md` | completed |

## Resume Planning

```text
Continue Kyro scope `00-p0-reproducibility-and-ci`. Read `.agents/kyro/scopes/00-p0-reproducibility-and-ci/state.json`, `.agents/kyro/scopes/00-p0-reproducibility-and-ci/index.json`, and `.agents/kyro/scopes/00-p0-reproducibility-and-ci/ROADMAP.summary.json` first. Then use kyro-forge to plan the next sprint. Open ROADMAP.md and finding Markdown only if the router requests missing details.
```

## Resume Execution

```text
Continue active Kyro sprint for `00-p0-reproducibility-and-ci`. Read state.json and index.json first, then the active SPRINT summary JSON if present. Use kyro-forge to route to execution, review, close, or recover. Open sprint Markdown only when required for the active task.
```

## Status

```text
Report Kyro status for `00-p0-reproducibility-and-ci`. Read state.json, index.json, ROADMAP.summary.json, SPRINT summaries, and DEBT.summary.json first. Use kyro-status brief unless full evidence is requested.
```

## Closeout

```text
Close the Kyro session for `00-p0-reproducibility-and-ci`. Read state.json, index.json, and the latest handoff first. Update summaries and re-entry prompts after any Markdown changes.
```
