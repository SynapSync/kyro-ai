# INIT Mode — Scope Bootstrap

Use INIT when a scope has no `sprint.json`. Analyze the request, then create project state through the Kyro CLI. Source code stays read-only; only Kyro state and write-only findings may be written.

## Inputs and routing

1. Resolve a kebab-case `scope`, repository path, and `.agents/kyro/scopes/{scope}/`. Existing `sprint.json` routes to `plan-sprint.md`.
2. Classify the work as `feature`, `bugfix`, `audit`, `refactor`, `new-project`, or `tech-debt`; load only `../helpers/analysis/{workType}.md`.
3. Read only what that helper requires. Write each distinct finding to `{outputDir}/findings/NN-slug.md` with summary, severity, affected files, and recommendation. Findings are write-only routing evidence.

## Size the roadmap

Choose the smallest justified sprint count. Every sprint needs a distinct, verifiable objective; multiple sprints require explicit split triggers and a rationale for why fewer or more would be wrong. Produce:

```json
{
  "plannedSprintCount": 2,
  "sizingRationale": "Explicit sizing rationale.",
  "sprints": [
    { "n": 1, "slug": "foundation", "title": "Foundation", "state": "planned" },
    { "n": 2, "slug": "hardening", "title": "Hardening", "state": "planned" }
  ]
}
```

Never pad the roadmap or generate Sprint 1 tasks here.

## Materialize the scope

Load `../templates/sprint.json`, then prepare a lean plan JSON containing:

- `scope`, `title`, one-sentence `objective`, and 2–5 measurable, technology-agnostic `successCriteria`.
- Optional `spec`: stable `requirements[]`, explicit `nonGoals[]`, unresolved `openQuestions[]`, and only already-unambiguous Given/When/Then `scenarios[]`.
- The sized `roadmap`. Do not include `author`; the CLI captures available git identity.

Unknown design-affecting details become `[NEEDS CLARIFICATION: <gap>]`; the CLI routes them to `clarify`. Never guess.

**Plan-grade Seedbed mapping:** for a matured-idea document, load `../helpers/seedbed-init-mapping.md` and apply its schema-safe mapping. Account for every material item. Do not load it on the normal one-line INIT path.

Run `{{KYRO_CLI}} plan --from <file>`. This validated, tool-owned command materializes `.agents/kyro/scopes/{scope}/sprint.json`, initializes conventions, ADRs, clarifications, and handoff, captures optional author identity, and registers project state.

On validation errors, fix the lean plan and retry. Direct writing is recovery-only when the CLI cannot run (`UNKNOWN_COMMAND`, missing binary, crash). In that case, use the Artifact Write Contract in `../../SKILL.md`: serialize the complete v4 document, write atomically, re-read, and parse. Never invent `author`. Do not update `kyro.json` until `sprint.json` verification succeeds.

If the user supplied non-negotiable principles, preserve them as project-level objects with `id`, `rule`, `severity`, `rationale`, and an applicable built-in `check`.

## Output

Report scope, work type, finding count, sprint count, sizing rationale, and created files. Next action is `/kyro:forge` to plan Sprint 1.
