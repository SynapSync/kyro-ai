---
title: "{scope} — Re-entry Prompts"
date: "{date}"
updated: "{date}"
scope: "{scope}"
type: "execution-plan"
status: "active"
version: "1.0"
agents:
  - "{agent_model}"
tags:
  - "{scope}"
  - "execution-plan"
  - "reentry"
  - "kyro-ai"
changelog:
  - version: "1.0"
    date: "{date}"
    changes: ["Re-entry prompts created"]
related:
  - "[[README]]"
  - "[[ROADMAP]]"
---

# {scope} — Re-entry Prompts

> Last updated: {date}
> Current sprint: {current_sprint_number}

Use these prompts to resume through summary-first routing. Open long Markdown only when a router asks for it.

## Fast Context

| Resource | Path |
|----------|------|
| State | `{output_kyro_dir}/state.json` |
| Index | `{output_kyro_dir}/index.json` |
| Roadmap Summary | `{output_kyro_dir}/ROADMAP.summary.json` |
| Sprints | `{output_kyro_dir}/phases/` |

## Resume Planning

```text
Continue Kyro scope `{scope}`. Read `{output_kyro_dir}/state.json`, `{output_kyro_dir}/index.json`, and `{output_kyro_dir}/ROADMAP.summary.json` first. Then use kyro-forge to plan the next sprint. Open ROADMAP.md or finding Markdown only if the router requests missing details.
```

## Resume Execution

```text
Continue active Kyro sprint for `{scope}`. Read state.json and index.json first, then the active SPRINT summary JSON if present. Use kyro-forge to route to execution, review, close, or recover. Open sprint Markdown only when required for the active task.
```

## Status

```text
Report Kyro status for `{scope}`. Read state.json, index.json, ROADMAP.summary.json, SPRINT summaries, and DEBT.summary.json first. Use kyro-status brief unless full evidence is requested.
```

## Closeout

```text
Close the Kyro session for `{scope}`. Read state.json and index.json first, then use kyro-wrap-up. Update summaries and re-entry prompts after any Markdown changes.
```
