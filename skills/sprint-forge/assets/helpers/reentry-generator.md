# Re-entry Generator

This helper defines how to generate and update re-entry prompts that allow context recovery across sessions.

---

## What Are Re-entry Prompts

Re-entry prompts are pre-written instructions that a new agent (or the same agent in a new session) can use to recover full project context. They specify:

- Which files to read and in what order
- What the current state of the project is
- What action to take next

They are the **context persistence mechanism** of Sprint Forge.

---

## 4 Scenarios

Each re-entry prompt covers a specific scenario:

| # | Scenario | When to Use | Key Context Needed |
|---|----------|-------------|-------------------|
| 1 | First Sprint | After INIT, before any sprint | README, ROADMAP, findings |
| 2 | Sprint N (next) | After completing Sprint N-1 | README, ROADMAP, last sprint (retro + recommendations + debt), next finding |
| 3 | Execute Sprint | Sprint generated but not executed | README, ROADMAP, current sprint file |
| 4 | Status | Any time, for progress report | README, ROADMAP, all sprint files |

---

## Prompt Structure

Each prompt must include:

1. **Project identifier**: Name and brief description
2. **Files to read**: Ordered list of files with absolute paths
3. **Current state**: What sprint is current, what's been done
4. **Action**: What the agent should do (invoke `/sprint-forge` with specific intent)
5. **Key notes**: Any important context (e.g., "Sprint 3 had a blocked task")

---

## Template Variables

The following variables are filled with actual values during INIT and updated after each sprint:

| Variable | Description | Example |
|----------|-------------|---------|
| `{project_name}` | Project name | `nebux-design-system-audit` |
| `{codebase_path}` | Absolute path to the codebase | `/Users/dev/projects/nebux` |
| `{output_sprint_forge_dir}` | Working directory for sprint artifacts | `/Users/dev/projects/nebux/.agents/sprint-forge/nebux-design-system-audit` |
| `{current_sprint}` | Current sprint number | `3` |
| `{last_sprint_file}` | Filename of the last completed sprint | `SPRINT-2-api-surface.md` |
| `{next_finding_file}` | Finding file for the next sprint | `03-component-quality.md` |
| `{latest_sprint_file}` | Filename of the latest sprint (may be in-progress) | `SPRINT-3-component-quality.md` |

---

## When to Generate

### After INIT

Generate ALL 4 prompts with:
- Actual project paths (codebase, output dir)
- Sprint 1 as the current/next sprint
- Finding file 01 as the first finding
- Write to `{output_sprint_forge_dir}/RE-ENTRY-PROMPTS.md`

### After Each Sprint Execution

Update prompts 2, 3, and 4:
- Increment current sprint number
- Update last sprint file reference
- Update next finding file reference
- Update any paths that may have changed
- Update Quick Reference table with new sprint status

Prompt 1 (First Sprint) can be left as-is or marked as "N/A — Sprint 1 already completed."

---

## Generation Process

1. Read the `REENTRY-PROMPTS.md` template from `assets/templates/`
2. Fill in all template variables with actual values
3. Write to `{output_sprint_forge_dir}/RE-ENTRY-PROMPTS.md`

For updates (after sprint execution):
1. Read the existing `RE-ENTRY-PROMPTS.md`
2. Update the relevant sections with new values
3. Update the Quick Reference table
4. Update the "Last updated" date
5. Write back

---

## Quick Reference Table

The re-entry prompts file includes a quick reference table that maps sprints to files:

| Sprint | File | Status |
|--------|------|--------|
| 1 | `sprints/SPRINT-1-architecture.md` | completed |
| 2 | `sprints/SPRINT-2-api-surface.md` | completed |
| 3 | `sprints/SPRINT-3-components.md` | in-progress |
| 4 | (not yet generated) | pending |

This table is updated after each sprint execution.

---

## Validation

After generating or updating re-entry prompts, verify:

- [ ] All file paths are absolute and correct
- [ ] Current sprint number matches reality
- [ ] Last sprint file exists at the specified path
- [ ] Quick Reference table matches actual sprint files
- [ ] Each scenario prompt has complete file read instructions
