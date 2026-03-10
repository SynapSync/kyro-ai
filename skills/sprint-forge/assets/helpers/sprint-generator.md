# Sprint Generator

This helper defines the step-by-step algorithm for generating a sprint from its inputs.

---

## Inputs

Every sprint generation requires these inputs:

| Input | Source | Required |
|-------|--------|----------|
| Roadmap sprint section | `ROADMAP.md` → Sprint {N} definition | Yes |
| Previous sprint | `sprints/SPRINT-{N-1}-*.md` → Retro, Recommendations, Debt table | Yes (except Sprint 1) |
| Finding file(s) | `findings/{NN}-*.md` → corresponding to this sprint's focus | Yes |
| User overrides | Direct user instructions (priority changes, scope adjustments) | No |

---

## Generation Algorithm

### Step 1 — Read Roadmap Section

Open `ROADMAP.md` and locate the section for Sprint {N}:
- Extract: title, focus, type, version target, suggested phases, dependencies
- Verify dependencies are met (previous sprints completed)

### Step 2 — Read Previous Sprint (Skip for Sprint 1)

Open the previous sprint file and extract:
- **Retro**: What went well, what didn't, surprises
- **Recommendations for Sprint N**: Numbered list of recommendations
- **Accumulated Debt Table**: Full table with all items and statuses

### Step 3 — Read Finding File(s)

Open the finding file(s) corresponding to this sprint:
- Extract: summary, details, severity, affected files, recommendations
- These become the primary source of tasks for the sprint

### Step 4 — Build Disposition of Recommendations

For Sprint 2+, create the Disposition table. For EACH recommendation from Sprint N-1:

| # | Recommendation | Action | Where | Justification |
|---|---------------|--------|-------|---------------|
| {n} | {text} | {action} | {location} | {why} |

**Action options**:
- **Incorporated**: This recommendation becomes a task in the current sprint. Specify which phase and task.
- **Deferred**: Postponed to a future sprint. Specify target sprint and justify why.
- **Resolved**: Already addressed by intervening work. Explain when and how.
- **N/A**: No longer applicable due to changed circumstances. Explain why.
- **Converted to Phase**: Recommendation was significant enough to become an entire phase (not just a task). Specify which phase.

**Rule**: Every recommendation MUST appear in this table. No recommendation can be silently dropped.

### Step 5 — Build Phases

Assemble the sprint's phases from three sources:

1. **Roadmap-suggested phases**: The phases defined in the roadmap for this sprint. These are the starting point.
2. **Recommendation phases**: If incorporated recommendations don't fit into existing phases, create new phases for them.
3. **Debt phases**: If debt items target this sprint, create a phase to address them (or integrate into existing phases).

For each phase:
- Define a clear objective
- List tasks with:
  - Checkbox `[ ]`
  - Task ID (T{phase}.{task}, e.g., T1.1, T1.2, T2.1)
  - Description
  - Affected files (if known from findings)
  - Verification criteria

### Step 6 — Copy and Update Debt Table

1. Copy the FULL debt table from Sprint N-1 (or start empty for Sprint 1)
2. Add new debt items discovered in the finding file analysis
3. Update status for items targeting this sprint: `open` → `in-progress`
4. Follow all rules from [debt-tracker.md](debt-tracker.md)

### Step 7 — Write Definition of Done

Create a checklist of completion criteria:
- All phase tasks completed or explicitly skipped
- Emergent phase tasks completed (will be empty at generation time)
- Debt table updated
- Retro filled
- Recommendations documented
- Re-entry prompts updated
- Any project-specific criteria (e.g., "all tests pass", "pub.dev score maintained")

### Step 8 — Leave Retro and Recommendations Empty

The Retro and Recommendations sections are filled at sprint CLOSE, not during generation. Leave them with placeholder markers.

### Step 9 — Write Sprint File

Save to: `{sprints_dir}/SPRINT-{N}-{slug}.md`

Where `{slug}` is a short descriptive slug derived from the sprint's focus (e.g., `architecture-cleanup`, `api-surface`, `component-quality`).

---

## Sprint Numbering

- Sequential: Sprint 1, Sprint 2, Sprint 3, ...
- No gaps: If Sprint 3 is removed from the roadmap, Sprint 4 does NOT become Sprint 3
- Files: `SPRINT-{N}-{slug}.md`

---

## Emergent Phases

Emergent phases are added during EXECUTION, not during generation. However, the sprint template includes a placeholder section for them.

During execution, if new work is discovered:
1. Add an "Emergent Phase" section after the planned phases
2. Mark it clearly with the reason for emergence
3. Give tasks IDs using `TE.{n}` format (T for Task, E for Emergent)
4. Update the DoD to include emergent tasks

### Findings Consolidation

Before closing the sprint, consolidate all discoveries into a summary table. This is a recommended closing phase that captures institutional knowledge:

1. Add a "Findings Consolidation" section after the last phase (planned or emergent)
2. Create a summary table with columns: `#`, `Finding`, `Origin Phase`, `Impact`, `Action Taken`
3. Include every significant discovery, not just those that generated tasks
4. This table becomes a quick-reference for future sprints and stakeholders

---

## Validation Checklist

Before writing the sprint file, verify:

- [ ] Roadmap section for this sprint has been read
- [ ] Previous sprint's retro, recommendations, and debt table have been read (Sprint 2+)
- [ ] Finding file(s) have been read
- [ ] Disposition table covers ALL previous recommendations (Sprint 2+)
- [ ] Phases include roadmap-suggested phases + recommendation phases + debt phases
- [ ] Debt table is copied in full from previous sprint
- [ ] Definition of Done is specific and verifiable
- [ ] Retro and Recommendations sections are empty (to be filled at close)
