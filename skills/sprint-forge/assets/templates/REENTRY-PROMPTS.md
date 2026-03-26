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
  - "kyro-workflow"
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

These prompts help you (or a new agent) recover full project context in a new session.

---

## Output Directory

```
{output_kyro_dir}
```

This is where all kyro-workflow documents for this project live. All file paths below are relative to this directory.

---

## Quick Reference

| Sprint | File | Status |
|--------|------|--------|
| 1 | `sprints/SPRINT-1-{slug}.md` | {status} |

---

## Dynamic Paths

| Resource | Path |
|----------|------|
| Codebase | `{codebase_path}` |
| Working Directory | `{output_kyro_dir}` |
| Roadmap | `{output_kyro_dir}/ROADMAP.md` |
| Latest Sprint | `{output_kyro_dir}/sprints/{latest_sprint_file}` |

---

## Scenario 1 — First Sprint (after INIT)

Use this prompt when INIT has been completed and you need to generate Sprint 1.

```
I'm working on the {scope} project. The analysis and roadmap have been created.

Read these files in order:
1. {output_kyro_dir}/README.md
2. {output_kyro_dir}/ROADMAP.md
3. The finding files in {output_kyro_dir}/findings/

Then use /kyro-workflow to generate Sprint 1. Follow the roadmap's Sprint 1 definition
and the corresponding finding file(s) as input.
```

---

## Scenario 2 — Next Sprint (Sprint N)

Use this prompt when Sprint N-1 is complete and you need to generate Sprint N.

```
I'm continuing work on the {scope} project. Sprint {N-1} has been completed.

Read these files in order:
1. {output_kyro_dir}/README.md
2. {output_kyro_dir}/ROADMAP.md
3. {output_kyro_dir}/sprints/{last_sprint_file} (pay attention to Retro, Recommendations, and Debt table)
4. The finding file(s) for Sprint {N}: {output_kyro_dir}/findings/{next_finding_file}

Then use /kyro-workflow to generate Sprint {N}. Ensure all recommendations from Sprint {N-1}
are addressed in the Disposition table.
```

---

## Scenario 3 — Execute Current Sprint

Use this prompt when a sprint has been generated but not yet executed.

```
I'm working on the {scope} project. Sprint {N} has been generated and needs execution.

Read these files in order:
1. {output_kyro_dir}/README.md
2. {output_kyro_dir}/ROADMAP.md
3. {output_kyro_dir}/sprints/{current_sprint_file}

Then use /kyro-workflow to execute Sprint {N}. Work through each phase and task,
marking progress as you go. Add emergent phases if new work is discovered.
```

---

## Scenario 4 — Check Project Status

Use this prompt to get a progress report.

```
I need a status report on the {scope} project.

Read these files:
1. {output_kyro_dir}/README.md
2. {output_kyro_dir}/ROADMAP.md
3. All sprint files in {output_kyro_dir}/sprints/

Then use /kyro-workflow to generate a status report showing: completed sprints,
accumulated debt, metrics, and what's planned next.
```
