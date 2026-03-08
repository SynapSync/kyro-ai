---
name: sprint-forge
description: >
  Adaptive sprint workflow: deep analysis, evolving roadmap, one-at-a-time sprints,
  formal debt tracking, and re-entry prompts for context persistence.
  Trigger: When the user wants to analyze a project, create a roadmap, generate/execute
  sprints iteratively, or check project status and technical debt.
license: Apache-2.0
metadata:
  author: synapsync
  version: "1.10"
  scope: [root]
  auto_invoke:
    # English triggers
    - "Analyze project or codebase"
    - "Audit code quality or architecture"
    - "Create a roadmap for a project"
    - "Generate the next sprint"
    - "Execute a sprint"
    - "Check project status or progress"
    - "Review technical debt"
    - "Start a new iterative project workflow"
    # Spanish triggers
    - "Analiza el proyecto o codebase"
    - "Audita la calidad o arquitectura del código"
    - "Crea un roadmap para el proyecto"
    - "Genera el siguiente sprint"
    - "Ejecuta el sprint"
    - "Estado del proyecto o progreso"
    - "Revisa la deuda técnica"
    - "Inicia un workflow de proyecto iterativo"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Task
---

# Sprint Forge

## Assets

This skill uses a modular assets architecture. Detailed workflows, helpers, and templates are in the [assets/](assets/) directory:

- **[assets/modes/](assets/modes/)** — INIT, SPRINT, and STATUS mode workflows
- **[assets/helpers/](assets/helpers/)** — Analysis guide, debt tracker, sprint generator, re-entry generator
- **[assets/templates/](assets/templates/)** — Roadmap, sprint, project README, and re-entry prompt templates

See [assets/README.md](assets/README.md) for full directory documentation.

---

## Purpose

Sprint Forge is an **adaptive sprint workflow** skill designed for iterative project execution. Unlike rigid planners that pre-generate all sprints upfront, Sprint Forge:

- **Analyzes first** — deep exploration of the project/issue before committing to a plan
- **Generates sprints one at a time** — each sprint feeds from the previous one's retro, recommendations, and accumulated debt
- **Tracks debt formally** — an accumulated debt table that persists across sprints and never loses items
- **Adapts the roadmap** — the plan evolves based on what execution reveals
- **Persists context** — re-entry prompts allow a new agent (or new session) to recover full context

This skill works for **any** project type, language, or framework.

---

## Critical Rules

> **RULE 1 — SPRINT-BY-SPRINT**
>
> Sprints are generated ONE AT A TIME. Never pre-generate all sprints. Each sprint is informed by the previous sprint's retro, recommendations, and accumulated debt. This ensures the plan adapts to reality.

> **RULE 2 — SUGGESTED PHASES, NOT RIGID**
>
> The roadmap defines suggested phases per sprint. During execution, emergent phases MUST be added when new findings surface. Phases are guidelines, not constraints.

> **RULE 3 — RETRO IS FORMAL INPUT**
>
> The retrospective and recommendations from Sprint N-1 are formal input for Sprint N. Every recommendation must either become a task in the next sprint or have its deferral justified in the Disposition table.

> **RULE 4 — DEBT NEVER DISAPPEARS**
>
> The Accumulated Technical Debt table is inherited sprint to sprint. An item is only closed when explicitly resolved. Items are never deleted — only their status changes.

> **RULE 5 — ADAPTIVE**
>
> The roadmap is a living document. If execution reveals that a planned sprint no longer makes sense, the roadmap is updated. The plan serves execution, not the reverse.

> **RULE 6 — LANGUAGE-AGNOSTIC**
>
> This skill works for any language, framework, or project type. It does not assume Flutter, React, Dart, or any specific technology. The analysis determines the structure.

> **RULE 7 — CONTEXT PERSISTENCE**
>
> After INIT and after each executed sprint, re-entry prompts are updated. These prompts allow any agent in any session to recover full project context and continue seamlessly.

---

## Capabilities Matrix

| Capability | INIT | SPRINT | STATUS |
|-----------|:----:|:------:|:------:|
| Analyze codebase/project | Yes | No | No |
| Create vault structure | Yes | No | No |
| Generate roadmap | Yes | No | No |
| Generate/update re-entry prompts | Yes | Yes | No |
| Generate sprint | No | Yes | No |
| Execute sprint tasks | No | Yes | No |
| Write/modify code | No | Yes | No |
| Read vault/sprints | Yes | Yes | Yes |
| Update accumulated debt | No | Yes | No |
| Report progress | No | No | Yes |

---

## Configuration Resolution

`{output_sprint_forge_dir}` is the directory where sprint-forge stores all project documents. Resolve it once at the start of any mode:

1. **Re-entry prompt** — If the user's message contains file paths (e.g. `/Users/.../ROADMAP.md`), extract `{output_sprint_forge_dir}` from those paths. It's already there.
2. **INIT (first time)** — Ask the user where to save documents. Store the chosen path in `README.md` and `RE-ENTRY-PROMPTS.md`. These are the only sources of truth.
3. **SPRINT/STATUS without re-entry prompt** — Auto-discover by scanning `.agents/sprint-forge/` in `{cwd}`, or ask the user directly.

No AGENTS.md. No branded blocks. The re-entry prompts and README carry the path across sessions.

### Frontmatter Properties

All generated markdown documents include YAML frontmatter following the [Obsidian markdown standard](../integrations/obsidian/assets/standards/obsidian-md-standard.md). The `agents` field tracks the AI model that generated or modified the document. Resolve `{agent_model}` from the model ID powering the current session (e.g., `"claude-opus-4-6"`, `"gpt-4o"`, `"codex"`, `"grok"`). When modifying an existing document, append the current model to the `agents` array if not already present.

---

## Mode Detection

| Mode | EN Signals | ES Signals | What It Does |
|------|-----------|-----------|-------------|
| **INIT** | "analyze", "audit", "start project", "create roadmap" | "analiza", "audita", "inicia proyecto", "crea roadmap" | Analyzes the project, generates findings, creates roadmap, scaffolds vault, generates re-entry prompts |
| **SPRINT** | "generate sprint", "next sprint", "execute sprint" | "genera sprint", "siguiente sprint", "ejecuta sprint" | Generates the next sprint from roadmap + previous sprint + debt, optionally executes it |
| **STATUS** | "project status", "progress", "technical debt" | "estado del proyecto", "progreso", "deuda técnica" | Reports completed sprints, accumulated debt, metrics, next sprint preview |

**Disambiguation**: If the user's intent is unclear, ask:

> "Do you want me to **analyze the project** (INIT), **generate/execute the next sprint** (SPRINT), or **check project status** (STATUS)?"

---

## Asset Loading (Mode-Gated)

After detecting the mode, read ONLY the assets listed for that mode. Do NOT read assets for other modes — they waste context tokens.

| Mode | Read These Assets | Do NOT Read |
|------|-------------------|-------------|
| **INIT** | `INIT.md`, `analysis-guide.md`, `reentry-generator.md` | SPRINT.md, STATUS.md, sprint-generator.md, debt-tracker.md |
| **SPRINT** | `SPRINT.md`, `sprint-generator.md`, `debt-tracker.md`, `reentry-generator.md` | INIT.md, STATUS.md, analysis-guide.md |
| **STATUS** | `STATUS.md`, `debt-tracker.md` | INIT.md, SPRINT.md, analysis-guide.md, sprint-generator.md, reentry-generator.md, all templates |

**On-demand assets**: Templates are loaded as each workflow step references them, not upfront.

---

## Quick Start

### INIT Mode

Use when starting a new project workflow:

```
Analyze this project and create a roadmap for the refactoring work.
```

This will: explore the codebase, generate findings, create an adaptive roadmap, scaffold the output directory, and generate re-entry prompts.

**Full workflow:** See [assets/modes/INIT.md](assets/modes/INIT.md)

### SPRINT Mode

Use when ready to work on the next sprint:

```
Generate the next sprint.
```

Or to generate and immediately execute:

```
Generate and execute the next sprint.
```

This will: read the roadmap and previous sprint, build the disposition table, generate phases, and optionally execute task by task.

**Full workflow:** See [assets/modes/SPRINT.md](assets/modes/SPRINT.md)

### STATUS Mode

Use to check project progress:

```
Show me the project status and technical debt.
```

This will: read all sprints, calculate metrics, display progress and accumulated debt.

**Full workflow:** See [assets/modes/STATUS.md](assets/modes/STATUS.md)

---

## Integration with Other Skills

| Skill | Integration |
|-------|------------|
| `code-analyzer` | INIT: Can be used as a preliminary step. The code-analyzer reports feed into Sprint Forge findings, providing structured technical input for the roadmap. |

---

## Limitations

1. **Mode boundary**: Each mode has specific capabilities — INIT cannot execute code, SPRINT cannot create roadmaps, STATUS cannot modify files
2. **One sprint at a time**: By design, you cannot generate multiple sprints in advance
3. **Requires analysis first**: SPRINT mode expects INIT to have been run — it needs a roadmap and findings
4. **Manual execution**: Sprint tasks are executed by the agent, not automated CI/CD
5. **Context window**: For projects with many sprints (>5), use separate sessions per sprint. Re-entry prompts ensure continuity.
6. **No automated validation**: Cannot verify that the roadmap matches codebase reality — relies on thorough analysis during INIT
7. **External blockers**: Cannot resolve dependencies on external teams — logs them as blocked tasks and moves on
8. **Debt resolution**: Debt items require explicit action to close — they don't auto-resolve
