---
description: Mature a rough or mature idea into an evidence-grounded, execution-ready brief (optional, pre-scope)
argument-hint: <idea or reference>
---

# /kyro:idea — Router

Turn an idea into a decision-complete, plan-grade artifact that can seed `/kyro:forge` or stand alone as an implementation handoff.

## Hard boundary

This command is pre-scope and read-only toward Kyro state. Never read, resolve, create, or modify `.agents/kyro/kyro.json`, `.agents/kyro/scopes/`, any `sprint.json`, or the installed runtime. It may read user-provided references and explicitly relevant project evidence. It uses one confirmed document path under `.agents/kyro/{docType}/`: one initial write plus at most one corrective overwrite after failed verification.

## Startup

1. Take the idea and referenced paths from `$ARGUMENTS` and the conversation. If neither exists, ask one question: "What idea or reference should we mature?" Then stop.
2. Load `skills/seedbed/assets/modes/idea.md` directly. Do not load the orchestrator.
3. Let the mode classify the input as `rough` or `mature`, gather permitted evidence, and run its sufficiency and quality gates.
4. Load only the Seedbed helpers named by the mode, and load `skills/seedbed/assets/templates/matured-idea.md` immediately before drafting.

## Rules

- Ask at most one question per turn and never re-ask facts already present in references or evidence.
- Ask only about a material gap that changes scope, behavior, architecture, validation, or success.
- Expose contradictions and assumptions. Never invent a material decision.
- Before writing, confirm the inferred `docType` and path. After writing, re-read that one file only to validate its structure and quality gate.
- If the artifact cannot reach the quality threshold because a material decision is unresolved, keep maturing it; do not persist a deceptively complete brief.
