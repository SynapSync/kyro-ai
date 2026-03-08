# INIT Mode — Analysis, Roadmap & Scaffolding

This mode performs deep analysis of a project, generates findings, creates an adaptive roadmap, scaffolds the working directory, and generates re-entry prompts.

---

## When This Mode Activates

| EN Signals | ES Signals |
|-----------|-----------|
| "analyze", "audit", "start project", "create roadmap", "analyze codebase" | "analiza", "audita", "inicia proyecto", "crea roadmap", "analiza el codebase" |

---

## Prerequisites

- Access to the codebase (local path or repository)
- No previous sprint-forge work for this project (if resuming, use SPRINT or STATUS mode)

---

## Workflow

### Step 1 — Detect Work Type

Determine the type of work from the user's request:

| Work Type | Signals |
|-----------|---------|
| Audit / Refactor | "analyze", "audit", "refactor", "review the codebase" |
| New Feature | "add feature", "implement", "build" |
| Bugfix | "fix", "broken", "error", "regression" |
| New Project | "start from scratch", "new project", "create project" |
| Tech Debt | "clean up", "deprecated", "reduce debt", "missing tests" |

**Reference**: See [analysis-guide.md](../helpers/analysis-guide.md) for detailed guidance per work type.

If the work type is ambiguous, ask the user:

> "Is this an audit/refactor, a new feature, a bugfix, a new project, or tech debt cleanup?"

### Step 2 — Resolve Configuration

Gather or detect the following configuration:

| Config | How to Resolve |
|--------|---------------|
| **Project Name** | Ask the user or derive from the codebase directory name. Use a slug format: `my-project-audit`. |
| **Codebase Path** | The absolute path to the codebase. Usually the current working directory. |
| **Sprint Output Dir** | `{output_sprint_forge_dir}/sprints/` (automatic, resolved below) |

**Resolve `{output_sprint_forge_dir}`** — ask the user:

> "Where should I save sprint-forge documents for **{project_name}**?
>
> 1. **Default** (Recommended) — `.agents/sprint-forge/{project-name}/`
> 2. **Custom path** — provide your preferred directory"

Set `{output_sprint_forge_dir}` based on the choice. This path will be embedded in `README.md` and `RE-ENTRY-PROMPTS.md` — those are the only sources of truth. No other persistence needed.

Confirm with the user:

> **Project**: {project_name}
> **Codebase**: `{codebase_path}`
> **Output**: `{output_sprint_forge_dir}`
>
> Proceed with this configuration?

### Step 3 — Deep Analysis

Perform thorough analysis based on the work type. This is the most critical step.

**Strategy**:
1. Use the **Explore agent** (Task tool with subagent_type=Explore) for broad codebase exploration
2. Use **Glob** to find files by pattern
3. Use **Grep** to search for specific patterns
4. Use **Read** to examine specific files in detail

**Analysis depth depends on work type**:
- **Audit/Refactor**: Explore the entire codebase. Every directory, every major file. Identify all areas of concern.
- **New Feature**: Focus on the integration points. Understand what exists and what gaps need filling.
- **Bugfix**: Trace the bug path. Reproduce, identify root cause, assess blast radius.
- **New Project**: Research requirements, comparable solutions, stack decisions.
- **Tech Debt**: Scan for debt indicators across the codebase.

**Reference**: See [analysis-guide.md](../helpers/analysis-guide.md) for the complete analysis strategy.

**Key Principle**: The analysis determines the structure. Do NOT start with a fixed list of categories. Let the project tell you what matters.

### Step 4 — Generate Findings

Write each distinct finding as a separate file:

**Location**: `{output_sprint_forge_dir}/findings/`

**Naming**: `NN-descriptive-slug.md` (e.g., `01-architecture-issues.md`)

**Content per file**: YAML frontmatter properties (following the template in analysis-guide.md) + Summary, severity, details with code examples, affected files, recommendations.

**Number of findings**: VARIABLE. Determined entirely by what the analysis reveals:
- Small project: 2-4 findings
- Medium refactor: 5-8 findings
- Major audit: 10-20+ findings

**Reference**: See [analysis-guide.md](../helpers/analysis-guide.md) → Step 3 for the finding file format.

### Step 5 — Create Roadmap

Using the [ROADMAP.md template](../templates/ROADMAP.md), create the adaptive roadmap:

1. Fill in project paths (codebase, output dir, findings, sprints)
2. Map each finding to a suggested sprint:
   - Finding 01 → Sprint 1 (usually, but not always)
   - Related findings may be grouped into a single sprint
   - Large findings may be split across multiple sprints
3. Define sprint dependencies (which sprints must complete before others)
4. For each sprint, define:
   - Title and focus
   - Source finding file(s)
   - Version target (if applicable)
   - Type (audit/refactor/feature/bugfix/debt)
   - Suggested phases (2-5 phases per sprint)
5. Fill in the Sprint Summary table
6. Write the dependency map

**Location**: `{output_sprint_forge_dir}/ROADMAP.md`

### Step 6 — Scaffold Working Directory

Create the full directory structure:

```
{output_sprint_forge_dir}/
├── README.md              ← From PROJECT-README.md template
├── ROADMAP.md             ← Created in Step 5
├── RE-ENTRY-PROMPTS.md    ← Created in Step 7
├── findings/              ← Created in Step 4
│   ├── 01-*.md
│   ├── 02-*.md
│   └── ...
└── sprints/               ← Empty directory, sprints created later
```

**README.md**: Use the [PROJECT-README.md template](../templates/PROJECT-README.md). Fill in the frontmatter properties with actual values, then fill in:
- Project name, type, date
- Description of the work
- All absolute paths
- Baseline metrics (if applicable)
- Initial sprint map from the roadmap

### Step 7 — Generate Re-entry Prompts

Using the [reentry-generator.md](../helpers/reentry-generator.md) helper:

1. Use the [REENTRY-PROMPTS.md template](../templates/REENTRY-PROMPTS.md)
2. Fill in all template variables with actual values:
   - `{project_name}`, `{codebase_path}`, `{output_sprint_forge_dir}`
   - `{current_sprint}` = 1 (no sprints yet)
   - Sprint 1 finding file path
3. Generate all 4 scenario prompts with real paths
4. Write to `{output_sprint_forge_dir}/RE-ENTRY-PROMPTS.md`

## Output Summary

At the end of INIT, present a summary:

```
## INIT Complete

**Project**: {project_name}
**Type**: {work_type}
**Findings**: {N} files in findings/
**Sprints Planned**: {M} sprints in roadmap
**Files Created**:
  - {output_sprint_forge_dir}/README.md
  - {output_sprint_forge_dir}/ROADMAP.md
  - {output_sprint_forge_dir}/RE-ENTRY-PROMPTS.md
  - {output_sprint_forge_dir}/findings/01-{slug}.md
  - {output_sprint_forge_dir}/findings/02-{slug}.md
  - ...

**Next Step**: Generate Sprint 1 using `/sprint-forge` or copy the re-entry prompt from RE-ENTRY-PROMPTS.md → Scenario 1.
```

---

## Error Handling

| Error | Action |
|-------|--------|
| Codebase path not found | Ask user for the correct path |
| Output directory already exists | Ask user: overwrite, use different name, or resume |
| No meaningful findings | Inform user — the codebase may be in good shape. Generate a minimal roadmap with maintenance sprints. |
| Analysis scope too large | Break into phases. Analyze the most critical areas first, note others as "needs deeper analysis" finding. |

---

## References

- [analysis-guide.md](../helpers/analysis-guide.md) — Analysis strategy per work type
- [ROADMAP.md template](../templates/ROADMAP.md) — Roadmap structure
- [PROJECT-README.md template](../templates/PROJECT-README.md) — Project README structure
- [REENTRY-PROMPTS.md template](../templates/REENTRY-PROMPTS.md) — Re-entry prompts structure
- [reentry-generator.md](../helpers/reentry-generator.md) — How to generate re-entry prompts
