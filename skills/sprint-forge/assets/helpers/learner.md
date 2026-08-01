# Kyro Learner — Per-Scope Rule Accumulation

## Purpose

Captures corrections, patterns, and estimation insights as persistent **conventions** stored in `sprint.json.conventions[]`. Conventions are scope-local and carried forward between sprints. `conventions[]` is the home for operational learned rules; durable architectural decisions with context/tradeoffs belong in `sprint.json.adrs[]`. Never create separate rules or ADR markdown files.

## Convention shape

Each convention is an **object**, never a plain string:

```json
{ "id": "test-1", "rule": "Mock patch context managers must cover the call, not just the assignment.", "tags": ["testing"], "addedSprint": 2 }
```

- `id`: short stable id, unique within the scope (e.g. `test-1`, `build-2`).
- `rule`: one line, specific and actionable — not a vague platitude.
- `tags`: category hints (`["testing"]`, `["build"]`, `["architecture"]`, `["process"]`, `["estimation"]`).
- `addedSprint`: the sprint number during which the rule was learned.

## Capture flow

When the user corrects the agent, or a pattern emerges from retro surprises or task evidence:

1. Detect the correction or pattern.
2. Propose the convention object (id, rule, tags, addedSprint).
3. On approval, ask whether the user wants the rule persisted globally for every Kyro scope. If the user already specified scope-only or global persistence, do not ask again.
4. Register it through the CLI:
   - Scope only: `{{KYRO_CLI}} rule add --rule "<rule>" --tag <tag> [--id <id>] --kyro-scope <scope>`
   - Scope + global project rule: add `--global` only after explicit confirmation. This writes the same convention to shared `project.json`, and every scope inherits it through `context-pack`.

Never hand-edit `sprint.json.conventions[]`, create `RULES.md`, or create any separate rule file. If `rule` is absent from the capability handshake or fails as unknown, abort and request a Kyro runtime upgrade.

During `close-sprint`, conventions are extracted from the retro and task evidence and registered through `{{KYRO_CLI}} rule add` before the close transaction (step 4 of `../modes/close-sprint.md`).

## Rule application

Conventions are already in context — `context-pack` merges global `project.json.conventions[]` with scope-local `sprint.json.conventions[]`. No extra read.

- Before planning sprint estimates, check `estimation`-tagged conventions.
- Before architecture decisions, check relevant `architecture`-tagged conventions and existing `adrs[]`.
- In `plan-sprint`, fold relevant conventions into each task's `context`.
- If about to violate a convention, pause and surface it.

## Rules about conventions

- Never add duplicates. Check existing `conventions[]` before proposing.
- Conventions must be specific and actionable.
- Conventions from user corrections have higher confidence than proactive suggestions.
- Keep the list lean — consolidate overlapping rules rather than accumulating noise (token budget is enforced by `{{KYRO_CLI}} doctor`).
- A bare string in `conventions[]` is schema drift and `{{KYRO_CLI}} doctor` will fail it.
- Do not store durable decision rationale in `conventions[]`; use `adrs[]` when the decision needs context, alternatives, and consequences.
