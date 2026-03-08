# SPRINT Mode — Generate & Execute Sprints

This mode generates the next sprint from roadmap + previous sprint + debt, and optionally executes it task by task.

---

## When This Mode Activates

| EN Signals | ES Signals |
|-----------|-----------|
| "generate sprint", "next sprint", "execute sprint", "run sprint", "continue sprint" | "genera sprint", "siguiente sprint", "ejecuta sprint", "corre sprint", "continúa sprint" |

---

## Sub-Modes

| Sub-Mode | Trigger | What Happens |
|----------|---------|--------------|
| **GENERATE** | "generate", "create", default when sprint file doesn't exist | Creates the sprint document only |
| **EXECUTE** | "execute", "run", "implement", sprint file already exists | Implements tasks from an existing sprint |
| **GENERATE+EXECUTE** | "generate and execute", "do the next sprint" | Generates then immediately executes |

If ambiguous, ask:

> "Should I **generate** the sprint document, **execute** an existing sprint, or **both**?"

---

## GENERATE Workflow

### Step 0 — Locate Output Directory

Determine `{output_sprint_forge_dir}` before reading any sprint files:

1. **Re-entry prompt paths** — If the user's message contains absolute file paths (e.g. `/Users/.../ROADMAP.md`), extract `{output_sprint_forge_dir}` from those paths. This is the most reliable source.
2. **Explicit path** — If the user mentions a path directly, use it.
3. **Auto-discover** — Scan `{cwd}/.agents/sprint-forge/`:
   - Single directory found → use it
   - Multiple directories → ask: "Which project? Found: {list}"
4. **Ask** — If none of the above: "Where are your sprint-forge documents? (e.g. `.agents/sprint-forge/my-project/`)"

Once resolved, all subsequent steps use `{output_sprint_forge_dir}` as the base for all file paths.

### Step 1 — Determine Sprint Number

1. Read `ROADMAP.md` to understand the planned sprints
2. Scan `sprints/` directory for existing sprint files
3. The next sprint number = highest existing sprint + 1
4. If no sprints exist, start with Sprint 1

### Step 2 — Gather Inputs

Read the required inputs as defined in [sprint-generator.md](../helpers/sprint-generator.md):

1. **Roadmap section**: Open `ROADMAP.md`, locate Sprint {N} definition
   - Extract: title, focus, type, version target, suggested phases
2. **Previous sprint** (Sprint 2+): Open `sprints/SPRINT-{N-1}-*.md`
   - Extract: Retro, Recommendations, Accumulated Debt Table
3. **Finding file(s)**: Open the finding file(s) mapped to this sprint in the roadmap
   - Extract: summary, details, affected files, recommendations

### Step 3 — Build Disposition Table (Sprint 2+)

For every recommendation from Sprint N-1, determine what happens to it:

| # | Recommendation | Action | Where | Justification |
|---|---------------|--------|-------|---------------|
| 1 | {text from sprint N-1} | Incorporated | Phase 2, T2.3 | Directly addresses API consistency |
| 2 | {text from sprint N-1} | Deferred | Sprint 5 | Requires schema migration first |
| 3 | {text from sprint N-1} | N/A | — | Fixed by Sprint 2 emergent phase |
| 4 | {text from sprint N-1} | Converted to Phase | Phase 4 | Significant enough to warrant its own phase |

**Every recommendation MUST appear in this table.** No exceptions.

**Action options**: Incorporated, Deferred, Resolved, N/A, **Converted to Phase** (when a recommendation becomes an entire phase, not just a task).

**Reference**: See [sprint-generator.md](../helpers/sprint-generator.md) → Step 4 for action options.

### Step 4 — Build Phases

Assemble phases from three sources:

1. **Roadmap-suggested phases**: Starting point from the roadmap
2. **Recommendation phases**: Incorporated recommendations that need their own phase
3. **Debt phases**: Debt items targeting this sprint

For each phase:
- **Objective**: Clear statement of what the phase accomplishes
- **Tasks**: List with checkboxes, task IDs (T{phase}.{task}), descriptions, file paths, verification criteria

**Reference**: See [sprint-generator.md](../helpers/sprint-generator.md) → Step 5 for phase assembly rules.

### Step 5 — Assemble Sprint Document

Use the [SPRINT.md template](../templates/SPRINT.md):

1. Fill frontmatter properties with actual values (title, date, project, sprint number, previous/next doc links, related findings)
2. Fill metadata: source finding, previous sprint, version target, type, carry-over count
3. Write sprint objective
4. Write Disposition table (Sprint 2+)
5. Write phases with tasks
6. Copy debt table from previous sprint + add new items
7. Write Definition of Done
8. Leave Retro and Recommendations sections EMPTY

**Reference**: See [debt-tracker.md](../helpers/debt-tracker.md) for debt table rules.

### Step 6 — Write Sprint File

Save to: `{sprints_dir}/SPRINT-{N}-{slug}.md`

The slug is derived from the sprint's focus area (e.g., `architecture-cleanup`, `api-consistency`).

---

## EXECUTE Workflow

### Step 7 — Read Sprint

Load the sprint file to execute. Verify it has:
- Phases with tasks
- Debt table
- Definition of Done

**Fill execution metadata**: Set `Execution Date` to today's date and `Executed By` to the executor's name in the sprint header. Also update the frontmatter `updated` field to today's date. These fields track who executed the sprint and when.

### Step 8 — Execute Task by Task

For each task in each phase:

1. **Mark in-progress**: Change `[ ]` to `[~]`
2. **Do the work**:
   - Read relevant files
   - Write/modify code as needed
   - Run verification commands
   - Test changes
3. **Mark done**: Change `[~]` to `[x]`
4. **Or mark blocked**: Change `[~]` to `[!]` with explanation
5. **Or mark carry-over**: Change `[~]` to `[>]` — when a task cannot be completed in this sprint but is not blocked. It will be carried over to the next sprint.

**Document evidence inline**: For each task, fill the `Evidence` field with concrete proof of work — trace logs, before/after snapshots, tables of affected items, verification marks. Evidence is not optional; it makes the sprint auditable.

**Execution order**: Process phases in order (Phase 1 → Phase 2 → ...). Within a phase, process tasks in order unless dependencies require different ordering.

**Persistence rule — checkpoint per phase**: After completing all tasks in a phase, write the sprint file to disk with all status updates (`[x]`, `[!]`, `[>]`) and evidence for that phase. This ensures progress survives unexpected interruptions (agent crash, session timeout, context overflow) without disrupting task-to-task flow within a phase. Do NOT write the file after every individual task — that fragments the agent's focus and wastes I/O. Do NOT defer all writes to sprint close — that risks losing all progress tracking on failure.

**Code quality**: Write production-quality code. Follow existing project patterns. Do not introduce new patterns without justification.

### Step 9 — Handle Emergent Work

During execution, you may discover work not covered by the plan. This is expected.

**When to add an Emergent Phase**:
- Found a bug that must be fixed before continuing
- Discovered a dependency that was not in the analysis
- A task reveals additional scope that cannot be deferred

**How to add**:
1. Add an "Emergent Phase" section in the sprint document (after planned phases)
2. Include: phase name, reason for emergence, tasks with IDs (TE.1, TE.2, ...)
3. Update Definition of Done to include emergent tasks

**Rule**: Do not add emergent phases for nice-to-haves. Only for work that is necessary to meet the sprint objective or that would create debt if deferred.

### Step 10 — Close Sprint

When all tasks are done (or explicitly skipped/blocked/carried-over):

**10a. Consolidate Findings**: Before filling the retro, complete the **Findings Consolidation** table. Review all phases (planned and emergent) and list every significant discovery with its origin, impact, and action taken. This creates an auditable trail of what was learned.

1. **Fill Retro section**:
   - What Went Well: Things that worked as expected or better
   - What Didn't Go Well: Challenges, blockers, things that took longer
   - Surprises: Unexpected findings or outcomes
   - **New Technical Debt Detected**: List new debt items discovered during execution, referencing their D{n} numbers from the Accumulated Debt table

2. **Fill Recommendations for Sprint N+1**:
   - Numbered list of specific, actionable recommendations
   - These become formal input for the next sprint's Disposition table
   - Include both technical and process recommendations

3. **Update Debt Table**:
   - Mark resolved items: Status → `resolved`, fill "Resolved In"
   - Add new items discovered during execution
   - Update deferred items if timelines changed
   - Follow all rules from [debt-tracker.md](../helpers/debt-tracker.md)

4. **Update Frontmatter**:
   - Set `updated` to today's date
   - Set `status` to `"completed"` (or `"active"` if carry-overs exist)
   - Set `progress` to final completion percentage (0-100)
   - Append changelog entry: `{"version": "1.1", "date": "{today}", "changes": ["Sprint completed"]}`

5. **Verify Definition of Done**:
   - Check every DoD item
   - Mark as complete or document why it's not

### Step 11 — Update Re-entry Prompts

After sprint execution:

1. Open `{output_sprint_forge_dir}/RE-ENTRY-PROMPTS.md`
2. Update current sprint number
3. Update file references (last sprint, next finding)
4. Update Quick Reference table with new sprint status
5. Update "Last updated" date

**Reference**: See [reentry-generator.md](../helpers/reentry-generator.md) for update rules.

### Step 12 — Update Roadmap (If Needed)

If execution revealed that the roadmap needs adjustment:

- A planned sprint no longer makes sense → remove or modify it
- A new sprint is needed → add it to the roadmap
- Sprint dependencies changed → update the dependency map
- Phase suggestions for future sprints should change → update them

**This is the ADAPTIVE principle**: The roadmap serves execution, not the reverse.

---

## Critical Rules for Sprint Mode

1. **One sprint at a time** — NEVER generate Sprint N+1 before Sprint N is complete
2. **Disposition is mandatory** — Every recommendation from Sprint N-1 must be in the Disposition table
3. **Emergent phases are welcome** — But only for necessary work, not nice-to-haves
4. **Debt table is inherited completely** — Never drop items, never reset the table
5. **Re-entry prompts must be updated** — Every sprint execution ends with a prompt update
6. **Retro is honest** — Don't sugarcoat. Document real challenges and surprises.
7. **Recommendations are specific** — "Improve tests" is not a recommendation. "Add unit tests for the auth middleware error paths in auth.ts:45-80" is.

---

## Error Handling

| Error | Action |
|-------|--------|
| No roadmap found | INIT mode must be run first. Inform user. |
| Previous sprint not found | Check if sprint numbering is correct. If Sprint 1, this is expected. |
| Finding file not found | Check roadmap mapping. The file may have been renamed or the mapping may be wrong. |
| All tasks blocked | Document blockers in retro, close sprint as incomplete, recommend resolution in Sprint N+1. |
| Sprint file already exists | Ask user: overwrite, resume execution, or skip to next sprint. |

---

## References

- [sprint-generator.md](../helpers/sprint-generator.md) — Sprint generation algorithm
- [debt-tracker.md](../helpers/debt-tracker.md) — Debt table rules
- [reentry-generator.md](../helpers/reentry-generator.md) — Re-entry prompt updates
- [SPRINT.md template](../templates/SPRINT.md) — Sprint document structure

