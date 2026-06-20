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
  version: "2.0"
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

# Kyro

## Assets

This skill uses a modular assets architecture. Detailed workflows, helpers, and templates are in the [assets/](assets/) directory:

- **[assets/modes/](assets/modes/)** — lightweight routers plus focused INIT, planning, execution, review, close, recover, and STATUS workflows
- **[assets/helpers/](assets/helpers/)** — Analysis guide, debt tracker, sprint generator, re-entry generator
- **[assets/templates/](assets/templates/)** — Roadmap, sprint, project README, and re-entry prompt templates

See [assets/README.md](assets/README.md) for full directory documentation.

---

## Purpose

Kyro is an **adaptive sprint workflow** skill designed for iterative project execution. Unlike rigid planners that pre-generate all sprints upfront, Kyro:

- **Analyzes first** — deep exploration of the project/issue before committing to a plan
- **Generates sprints one at a time** — each sprint feeds from the previous one's retro, recommendations, and accumulated debt
- **Tracks debt formally** — an accumulated debt table that persists across sprints and never loses items
- **Adapts the roadmap** — the plan evolves based on what execution reveals
- **Persists context cheaply** — compact task events plus `state.json`, `index.json`, summaries, and re-entry prompts let new agents recover without rereading every Markdown file

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

> **RULE 7 — LEAN CONTEXT PERSISTENCE**
>
> During task execution, write compact task events and minimal routing state only. After INIT and sprint close, update `state.json`, `index.json`, relevant `*.summary.json`, and re-entry prompts. Agents read structured state before opening long Markdown evidence.

---

## Capabilities Matrix

| Capability | INIT | SPRINT | STATUS |
|-----------|:----:|:------:|:------:|
| Analyze codebase/project | Yes | No | No |
| Create vault structure | Yes | No | No |
| Generate roadmap | Yes | No | No |
| Generate/update re-entry prompts | Yes | Sprint close only | No |
| Update state/index/summaries | Yes | Compact during execution, full at close | Yes |
| Generate sprint | No | Yes | No |
| Execute sprint tasks | No | Yes | No |
| Write/modify code | No | Yes | No |
| Read vault/sprints | Yes | Yes | Yes |
| Update accumulated debt | No | Yes | No |
| Report progress | No | No | Yes |
| Run review and debug protocols | No | Yes (review checklist, debug protocol) | No |
| Propose learned rules | No | Yes (via retro) | No |
| Validate tasks with checklist | No | Yes (BLOCKER/WARNING/SUGGESTION) | No |

---

## Configuration Resolution

`{output_kyro_dir}` is the directory where kyro stores all project documents. Resolve it once at the start of any mode:

1. **Re-entry prompt** — If the user's message contains file paths (e.g. `/Users/.../ROADMAP.md`), extract `{output_kyro_dir}` from those paths. It's already there.
2. **INIT (first time)** — Ask the user where to save documents. Store the chosen path in `README.md` and `RE-ENTRY-PROMPTS.md`. These are the only sources of truth.
3. **SPRINT/STATUS without re-entry prompt** — Auto-discover by scanning `.agents/kyro/scopes/` in `{cwd}`, or ask the user directly.

The project state lives in `.agents/kyro/kyro.json`; scoped state lives in `.agents/kyro/scopes/{scope}/state.json` and `index.json`. Re-entry prompts and README remain human handoff aids, not startup requirements.

### Frontmatter Properties

All generated markdown documents include YAML frontmatter. See the templates at `assets/templates/` for the expected frontmatter structure. The `agents` field tracks the AI model or agent that generated or modified the document. Resolve `{agent_model}` from the model or agent ID powering the current session (e.g., `"gpt-5"`, `"codex"`, `"cursor"`, `"opencode"`). When modifying an existing document, append the current model or agent to the `agents` array if not already present.

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
| **INIT** | `INIT.md`, then one routed `helpers/analysis/{workType}.md` helper | SPRINT.md, STATUS.md, sprint-generator.md, debt-tracker.md, unrelated analysis helpers |
| **SPRINT** | `SPRINT.md`, then exactly one routed mode: `plan-sprint.md`, `execute-task.md`, `review-task.md`, `close-sprint.md`, or `recover.md` | INIT.md, STATUS.md, unrelated modes/helpers/templates |
| **STATUS** | `STATUS.md`, `debt-tracker.md` | INIT.md, SPRINT.md, analysis helpers, sprint-generator.md, reentry-generator.md, all templates |

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

This will: read structured state first, route to planning or execution, and load only the mode/helper files needed for the current step.

**Router:** See [assets/modes/SPRINT.md](assets/modes/SPRINT.md)

### STATUS Mode

Use to check project progress:

```
Show me the project status and technical debt.
```

This will: read summaries first, calculate metrics, and open Markdown only when summaries are missing or a full report requires evidence.

**Full workflow:** See [assets/modes/STATUS.md](assets/modes/STATUS.md)

---

## Integration with Other Skills

| Skill | Integration |
|-------|------------|
| `code-analyzer` | INIT: Can be used as a preliminary step. The code-analyzer reports feed into Kyro findings, providing structured technical input for the roadmap. |

---

## Workflow Components

Kyro operates as a workflow with one orchestrator agent, built-in checkpoints, and commands. The SKILL.md remains the sprint-forge orchestration logic:

### Agent

The orchestrator is the single agent, handling all phases through specialized protocols:

| Protocol | Role | When Used |
|----------|------|-----------|
| Analysis protocol | Read-only codebase analysis | INIT mode — deep codebase exploration |
| Review checklist | Task quality validation | SPRINT mode — validates each task before closure |
| Debug protocol | Root cause investigation | SPRINT mode — invoked on task failure |
| Full cycle coordination | Gate management and sprint lifecycle | /kyro:forge command — coordinates all phases with gates |

### Commands

| Command | Maps To |
|---------|---------|
| `/kyro:forge` | Full cycle: INIT → SPRINT → Review → Close with validation gates |
| `/kyro:status` | STATUS mode with sprint progress and debt summary |
| `/kyro:wrap-up` | End-of-session closure ritual with quality check and context handoff |

### Built-In Checkpoints

The orchestrator runs checkpoints at lifecycle moments. Key checkpoints:
- **session_start** — loads learned rules from `.agents/kyro/scopes/rules.md`
- **post_edit_scan** — checks for debug artifacts after code edits
- **task_complete** — runs review checklist and records compact evidence
- **drift_check** — detects possible scope drift when enabled
- **rule_check** — checks relevant learned rules before task execution

### Per-Project Learning

Corrections during sprint execution are captured as persistent rules in `.agents/kyro/scopes/rules.md`. These rules are loaded at session start and applied automatically in future sprints. See the learner helper (`assets/helpers/learner.md`) for details.

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
