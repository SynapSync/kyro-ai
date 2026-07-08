---
description: Mature a rough idea into a written brief before starting a Kyro scope (optional, no scope required)
argument-hint: <rough idea>
---

# /kyro:idea — Idea Maturation

Refine a vague idea into a structured brief through a bounded, open-ended conversation. At the end, write the brief to a predictable path and suggest starting a Kyro scope seeded with that brief.

**This command does not require an active scope, `kyro.json`, or `sprint.json`. It is fully optional — skipping it and going straight to `/kyro:forge` is equally valid.**

## Startup

1. If `$ARGUMENTS` is empty, ask the user for a one-line idea: "What's the rough idea?"
2. Load `agents/orchestrator.md`, then directly `skills/sprint-forge/assets/modes/idea.md` (no `kyro.json` or `sprint.json` read — this command runs pre-scope).
3. Pass the idea (or argument) to the idea mode to begin the maturation loop.

## Rules

- Do not attempt to read or create `.agents/kyro/kyro.json`, `.agents/kyro/scopes/`, or any `sprint.json`.
- Load only the orchestrator agent + the idea mode — no other helpers or assets unless the idea mode requests them.
- When the idea mode signals done (user confirmation or soft/hard limit reached), the mode writes exactly one markdown file to `.agents/kyro/{docType}/{date}-{slug}.md` and proposes next steps.
- Never invent an answer to dodge a question — that is exactly the failure this pre-scope maturation prevents.
