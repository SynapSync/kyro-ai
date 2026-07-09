---
name: seedbed
description: Mature a rough idea into a structured pre-scope brief through a bounded conversation, before any Kyro scope exists
license: Apache-2.0
metadata:
  author: synapsync
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Mature an idea into a brief"
    - "Help me shape a rough idea before starting"
    - "Madurar una idea antes de arrancar"
    - "Convertir una idea vaga en un brief"
---

# Kyro Seedbed — Idea Maturation (pre-scope)

Seedbed turns a rough idea into one structured brief a strong team could act on — *before* any scope, `sprint.json`, or `kyro.json` exists. It is fully optional and agnostic: it never reads, resolves, or creates scope state, and going straight to `/kyro:forge` without it is equally valid.

## When to Use This Skill

- The user has a vague idea and wants to think it through before committing to build.
- Invoked directly by the `/kyro:idea` command.

Do **not** load this skill during an active forge/sprint cycle — it is pre-scope only and shares no state with `sprint-forge`.

## Workflow

Load `assets/modes/idea.md` — that mode is the whole maturation loop (bounded, one question at a time). It writes exactly one markdown document to `.agents/kyro/{docType}/{date}-{slug}.md` using `assets/templates/matured-idea.md`, then suggests seeding a scope with `/kyro:forge`.

## Boundaries

- Never reads, creates, or resolves a scope, `kyro.json`, or any `sprint.json` — not even to check existence.
- Never touches `kyro.json.principles[]`; the matured-idea document is write-only evidence, never re-read to route.
- No CLI validator (`doctor`, `analyze`) inspects seedbed output.
