# Kyro Learner — Per-Scope Rule Accumulation

## Purpose

Captures corrections, patterns, and estimation insights as persistent **conventions** stored in `sprint.json.conventions[]`. Conventions are scope-local and carried forward between sprints. There is no `rules.md` — `conventions[]` is the single home for learned rules (a `rules.md` is a v3 artifact; never create one).

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
3. On approval, append it to `sprint.json.conventions[]` using the Artifact Write Contract in `../../SKILL.md` (read → parse → push to `conventions[]` → overwrite the whole file → re-parse).

During `close-sprint`, conventions are extracted from the retro and task evidence and appended the same way (step 4 of `../modes/close-sprint.md`).

## Rule application

Conventions are already in context — every mode reads `sprint.json`, which contains `conventions[]`. No extra read.

- Before planning sprint estimates, check `estimation`-tagged conventions.
- Before architecture decisions, check `architecture`-tagged conventions.
- In `plan-sprint`, fold relevant conventions into each task's `context`.
- If about to violate a convention, pause and surface it.

## Rules about conventions

- Never add duplicates. Check existing `conventions[]` before proposing.
- Conventions must be specific and actionable.
- Conventions from user corrections have higher confidence than proactive suggestions.
- Keep the list lean — consolidate overlapping rules rather than accumulating noise (token budget is enforced by `kyro doctor`).
- A bare string in `conventions[]` is schema drift and `kyro doctor` will fail it.
