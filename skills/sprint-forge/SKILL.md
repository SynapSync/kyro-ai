---
name: sprint-forge
description: >
  Adaptive sprint workflow with lean context loading, compact execution evidence,
  formal debt tracking, and sprint-close materialization.
license: Apache-2.0
metadata:
  author: synapsync
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "Analyze project or codebase"
    - "Audit code quality or architecture"
    - "Create a roadmap for a project"
    - "Generate the next sprint"
    - "Execute a sprint"
    - "Check project status or progress"
    - "Review technical debt"
    - "Analiza el proyecto o codebase"
    - "Audita la calidad o arquitectura del código"
    - "Crea un roadmap para el proyecto"
    - "Genera el siguiente sprint"
    - "Ejecuta el sprint"
    - "Estado del proyecto o progreso"
    - "Revisa la deuda técnica"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Task
---

# Kyro Sprint Forge — Runtime Contract

Kyro runs adaptive sprint work without loading the whole workflow upfront. Commands route from structured state first, then load exactly one mode and only its named helpers/templates.

## Core Invariants

1. Generate one sprint at a time; never pre-generate the roadmap's future sprint files.
2. Previous retro, recommendations, and debt feed the next sprint.
3. Roadmap phases are guidance; add emergent phases only when they block the sprint objective or prevent hidden debt.
4. Debt never disappears; close debt only by explicit resolution.
5. During execution, write compact task events and minimal routing state only.
6. At sprint close, materialize Markdown evidence, summaries, debt, re-entry prompts, roadmap updates, and rule proposals.
7. Read summaries before Markdown; Markdown is opened only for missing evidence or mutation.

## Mode Loading

| Mode | Load | Do not load |
|------|------|-------------|
| INIT | `modes/INIT.md` + one `helpers/analysis/{workType}.md` | SPRINT, STATUS, sprint/debt/re-entry helpers |
| Plan sprint | `modes/SPRINT.md`, `modes/plan-sprint.md`, then `helpers/sprint-generator.md` | execution/review/close helpers |
| Execute task | `modes/SPRINT.md`, `modes/execute-task.md` | sprint-generator, debt-tracker, reentry-generator |
| Review task | `modes/SPRINT.md`, `modes/review-task.md`, `helpers/reviewer.md` | sprint-generator, reentry-generator |
| Close sprint | `modes/SPRINT.md`, `modes/close-sprint.md`, debt/re-entry helpers as needed | INIT and planning helpers |
| STATUS | `modes/STATUS.md` | INIT, SPRINT, templates, sprint-generator |

Templates are loaded only immediately before writing their artifact.

## Artifact Contract

- Project state: `.agents/kyro/kyro.json`.
- Scope state: `.agents/kyro/scopes/{scope}/state.json` and `index.json`.
- Compact events: `.agents/kyro/scopes/{scope}/events.ndjson`.
- Rule index: `.agents/kyro/scopes/rules.index.json`; open `rules.md` only when a matching rule may apply or when closing/proposing rules.
- Re-entry prompts update only at INIT, sprint close, and wrap-up.

## Boundaries

- INIT is read-only against source code until writing Kyro artifacts.
- SPRINT may modify project code/docs but must validate touched areas.
- STATUS is read-only unless explicitly mutating debt status.
- Recover preserves user-authored Markdown and rebuilds structured state from the best available evidence.
