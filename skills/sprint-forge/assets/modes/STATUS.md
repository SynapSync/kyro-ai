# STATUS Mode — Project Progress Report

This mode reads all project artifacts and generates a comprehensive progress report.

---

## When This Mode Activates

| EN Signals | ES Signals |
|-----------|-----------|
| "project status", "progress", "progress report", "technical debt", "how's the project going" | "estado del proyecto", "progreso", "reporte de progreso", "deuda técnica", "cómo va el proyecto" |

---

## Prerequisites

- INIT mode must have been run (README.md, ROADMAP.md, and at least one finding file exist)
- At least one sprint should exist for meaningful metrics (but STATUS works even with zero sprints)

---

## Workflow

### Step 0 — Locate Output Directory

Before reading any files, determine `{output_sprint_forge_dir}`:

1. If the user's request includes an explicit path, use it
2. Otherwise, check `{cwd}/.agents/sprint-forge/` — if a single project directory exists, use it
3. If multiple directories exist, ask: "Which project? Found: {list}"
4. If none found, ask: "Where are your sprint-forge documents? (e.g. `.agents/sprint-forge/my-project/`)"

### Step 1 — Read Project State

Read the following files:

1. `{output_sprint_forge_dir}/README.md` — Project overview and paths
2. `{output_sprint_forge_dir}/ROADMAP.md` — Planned sprints, dependencies, execution rules
3. All sprint files in `{output_sprint_forge_dir}/sprints/` — Progress, debt, retros

### Step 2 — Calculate Metrics

From the roadmap and sprint files, compute:

| Metric | How to Calculate |
|--------|-----------------|
| **Total Planned Sprints** | Count sprints defined in ROADMAP.md |
| **Completed Sprints** | Count sprint files with all DoD items checked |
| **In-Progress Sprints** | Sprint files with some tasks done but DoD incomplete |
| **Remaining Sprints** | Total - Completed - In-Progress |
| **Total Tasks** | Sum of all tasks across all generated sprint files |
| **Completed Tasks** | Sum of `[x]` tasks |
| **Blocked Tasks** | Sum of `[!]` tasks |
| **Skipped Tasks** | Sum of `[-]` tasks |
| **Open Debt Items** | Count debt items with status `open` or `in-progress` in latest sprint |
| **Resolved Debt Items** | Count debt items with status `resolved` in latest sprint |
| **Deferred Debt Items** | Count debt items with status `deferred` in latest sprint |
| **Emergent Phases** | Count of emergent phases added across all sprints |

### Step 3 — Generate Report

Output the report directly to the console (do NOT write to a file):

```
# {project_name} — Status Report

> Generated: {date}
> Codebase: `{codebase_path}`
> Working Dir: `{output_sprint_forge_dir}`

---

## Progress Overview

| Metric | Value |
|--------|-------|
| Sprints | {completed}/{total} completed ({percentage}%) |
| Tasks | {done}/{total} completed, {blocked} blocked, {skipped} skipped |
| Debt | {open} open, {resolved} resolved, {deferred} deferred |
| Emergent Phases | {count} added during execution |

---

## Sprint Progress

| Sprint | Status | Tasks | Key Deliverables |
|--------|--------|-------|-----------------|
| Sprint 1 | completed | 12/12 | Architecture cleanup |
| Sprint 2 | completed | 10/14 | API surface audit |
| Sprint 3 | in-progress | 3/8 | Component quality |
| Sprint 4 | pending | — | Testing infrastructure |

---

## Accumulated Technical Debt

{Copy the debt table from the latest sprint file}

**Debt Trend**: {Is open count growing or shrinking?}
**Oldest Open Item**: {Item that has been open the longest}

---

## Roadmap Health

- **Adaptations Made**: {Number of times the roadmap was modified}
- **Original Sprint Count**: {From initial INIT}
- **Current Sprint Count**: {After adaptations}
- **Sprints Added**: {count}
- **Sprints Removed**: {count}
- **Assessment**: {Is the roadmap still serving the project well?}

---

## Next Sprint Preview

**Sprint {N}**: {title}
- Focus: {focus}
- Source: `findings/{finding_file}`
- Dependencies: {which sprints must complete first}
- Carry-over: {count} recommendations from Sprint {N-1}

---

## Re-entry Prompt

{The appropriate re-entry prompt for the next action — usually Scenario 2 or 3 from RE-ENTRY-PROMPTS.md}
```

---

## Edge Cases

| Situation | Handling |
|-----------|---------|
| No sprints generated yet | Show INIT results only (findings count, roadmap overview). Suggest generating Sprint 1. |
| All sprints complete | Show final metrics. Highlight any remaining open debt. Suggest project closure or maintenance phase. |
| Sprint in progress | Show current sprint progress. Highlight blocked tasks. Suggest resuming execution. |
| No debt items | Note that no technical debt has been logged. This could mean the project is clean or debt isn't being tracked. |

---

## References

- [debt-tracker.md](../helpers/debt-tracker.md) — Debt table format and reporting rules
