---
description: Mature a rough idea into a written brief before starting a Kyro scope (optional, no scope required)
argument-hint: <rough idea>
---

# /kyro:idea — Router

Refine a vague idea into a structured brief through a bounded conversation, write it to a predictable path, then suggest starting a Kyro scope seeded with it.

**Non-negotiable — this command is pre-scope by definition.** NEVER read, resolve, create, or load a scope, `.agents/kyro/kyro.json`, or any `sprint.json` — not even to check whether they exist. This command does not go through the orchestrator and does not participate in `handoff.nextAction` routing. It is fully optional: skipping it and going straight to `/kyro:forge` is equally valid.

## Startup

1. Take the rough idea from `$ARGUMENTS`. If empty, ask the user for a one-line idea: "What's the rough idea?"
2. Load `skills/sprint-forge/assets/modes/idea.md` directly (no `kyro.json`, no `sprint.json`, no scope resolution). That mode is the whole workflow.
3. Pass the idea to the mode and begin the maturation loop.

## Rules

- Do not read, create, or resolve `.agents/kyro/kyro.json`, `.agents/kyro/scopes/`, or any `sprint.json`. The only file this command's mode ever writes is one matured-idea document under `.agents/kyro/{docType}/`.
- Do not load `agents/orchestrator.md` or any other mode/helper — only `skills/sprint-forge/assets/modes/idea.md`, plus the `matured-idea.md` template immediately before the final write.
- When the mode signals done (user confirmation or soft/hard limit reached), it writes exactly one markdown file to `.agents/kyro/{docType}/{date}-{slug}.md` and proposes next steps.
- Never invent an answer to dodge a question — that is exactly the failure this pre-scope maturation prevents.
