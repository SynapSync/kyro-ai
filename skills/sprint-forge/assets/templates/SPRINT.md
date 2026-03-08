---
title: "Sprint {N} — {title}"
date: "{date}"
updated: "{date}"
project: "{project_name}"
type: "sprint-plan"
status: "active"
version: "1.0"
sprint: {N}
progress: 0
previous_doc: "[[SPRINT-{N-1}-{previous_slug}]]"
next_doc: "[[SPRINT-{N+1}-{next_slug}]]"
parent_doc: "[[ROADMAP]]"
agents:
  - "{agent_model}"
tags:
  - "{project_name}"
  - "sprint-plan"
  - "sprint-{N}"
changelog:
  - version: "1.0"
    date: "{date}"
    changes: ["Sprint generated"]
related:
  - "[[ROADMAP]]"
  - "[[{finding_file_ref}]]"
---

# Sprint {N} — {title}

> Source: `findings/{finding_file}`
> Previous Sprint: `sprints/{previous_sprint_file}` | None
> Version Target: {version}
> Type: {type}
> Carry-over: {carry_over_count} items from previous sprint
> Execution Date: {execution_date}
> Executed By: {executor}

---

## Sprint Objective

{Clear, one-paragraph description of what this sprint aims to accomplish.}

---

## Disposition of Previous Sprint Recommendations

<!-- Skip this section for Sprint 1 (no previous sprint). -->
<!-- For Sprint 2+, EVERY recommendation from Sprint N-1 must appear here. -->

| # | Recommendation | Action | Where | Justification |
|---|---------------|--------|-------|---------------|
| 1 | {recommendation_text} | Incorporated / Deferred / Resolved / N/A | Phase X, Task Y / Sprint Z | {why} |

**Actions**:
- **Incorporated**: Added as a task in this sprint. Specify phase and task.
- **Deferred**: Postponed to a future sprint. Specify target sprint and justify.
- **Resolved**: Already resolved by previous work. Explain when/how.
- **N/A**: No longer applicable. Explain why.
- **Converted to Phase**: Recommendation was significant enough to become an entire phase (not just a task). Specify which phase.

---

## Phases

### Phase 1 — {phase_name}

**Objective**: {What this phase accomplishes}

**Tasks**:

- [ ] **T1.1**: {task_description}
  - Files: `{file_path}`
  - Evidence: {inline_evidence — e.g., trace logs, before/after snapshots, table of affected items, verification marks}
  - Verification: {how_to_verify}

- [ ] **T1.2**: {task_description}
  - Files: `{file_path}`
  - Evidence: {inline_evidence}
  - Verification: {how_to_verify}

### Phase 2 — {phase_name}

**Objective**: {What this phase accomplishes}

**Tasks**:

- [ ] **T2.1**: {task_description}
  - Files: `{file_path}`
  - Verification: {how_to_verify}

<!-- Add more phases as needed. Phases come from the roadmap's suggested phases + recommendations + debt items. -->

---

## Emergent Phases

<!-- This section starts EMPTY. It is populated during sprint EXECUTION when new work is discovered.
     Emergent phases are expected and encouraged. They represent the adaptive nature of this workflow. -->

<!-- Example:
### Emergent Phase — {name}

**Reason**: {Why this phase was added during execution}

**Tasks**:

- [ ] **TE.1**: {task_description}
  - Files: `{file_path}`
  - Verification: {how_to_verify}
-->

---

## Findings Consolidation

<!-- This section is filled during sprint CLOSE, before the Retro. Consolidate ALL significant discoveries made during execution into a single reference table. -->

| # | Finding | Origin Phase | Impact | Action Taken |
|---|---------|-------------|--------|-------------|
| 1 | {finding_description} | Phase {X} / Emergent | {high/medium/low} | {task_ref / debt_ref / deferred} |

<!-- Include every significant discovery, not just those that generated tasks. This table becomes a quick-reference for future sprints. -->

---

## Accumulated Technical Debt

<!-- For Sprint 1: start fresh. For Sprint 2+: copy the FULL table from Sprint N-1 and add new items. -->

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1 | {debt_item} | {where_discovered} | Sprint {X} | open | — |

**Status values**: `open` | `in-progress` | `resolved` | `deferred` | `carry-over`

**Rules**:
- Never delete a row — only change status
- New items are appended at the bottom
- Inherited items keep their original numbers
- When resolved, fill "Resolved In" with the sprint number

---

## Definition of Done

- [ ] All phase tasks completed or explicitly skipped with justification
- [ ] All emergent phase tasks completed
- [ ] Accumulated debt table updated (new items added, resolved items marked)
- [ ] Retro section filled
- [ ] Recommendations for next sprint documented
- [ ] Re-entry prompts updated to reflect current state
- [ ] {project_specific_criteria}

---

## Retro

<!-- Filled when the sprint is CLOSED. Do not fill during generation. -->

### What Went Well

-

### What Didn't Go Well

-

### Surprises / Unexpected Findings

-

### New Technical Debt Detected

<!-- List new debt items discovered during this sprint, referencing their D{n} numbers from the Accumulated Debt table. -->

-

---

## Recommendations for Sprint {N+1}

<!-- Filled when the sprint is CLOSED. Each recommendation becomes a candidate task for the next sprint.
     The next sprint's Disposition table will address each one. -->

1.
2.
3.
