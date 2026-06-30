# INIT Mode — Scope Analysis & sprint.json Bootstrap

Use INIT when a scope has no `sprint.json`. Produces exactly two things: a new `sprint.json` and an updated `kyro.json`. Nothing else (besides write-only `findings/`).

## Inputs

- User request and current repository path.
- `.agents/kyro/kyro.json` if present (to know existing scopes).
- One work-type helper under `../helpers/analysis/` after work-type detection.

## Step 1 — Resolve scope

Determine `scope` (kebab-case work topic) and `codebasePath`. Output dir: `.agents/kyro/scopes/{scope}/`. If `sprint.json` already exists there, stop and route to `plan-sprint.md` instead.

## Step 2 — Detect work type

Classify as `feature`, `bugfix`, `audit`, `refactor`, `new-project`, or `tech-debt`. Load only the matching helper: `../helpers/analysis/{workType}.md`.

## Step 3 — Analyze

Read only what the work type requires. Let evidence determine findings. Write each distinct finding to `{outputDir}/findings/NN-slug.md` (summary, severity, affected files, recommendation). These are write-only human evidence; agents never re-read them to route.

## Step 4 — Size the roadmap

Produce sizing before writing anything:

```json
{
  "plannedSprintCount": 2,
  "sizingRationale": "Why this many sprints — explicit split triggers and why not fewer/more.",
  "sprints": [
    { "n": 1, "slug": "foundation-cleanup", "title": "Foundation: cleanup", "state": "planned" },
    { "n": 2, "slug": "validation-hardening", "title": "Validation hardening", "state": "planned" }
  ]
}
```

Rules: every sprint needs a distinct verifiable objective. Multi-sprint plans need explicit split triggers. Never pad to look thorough.

## Step 5 — Write sprint.json

Load `../templates/sprint.json`. Fill:

- `scope`, `title`, `status: "planning"`, `objective` (one sentence).
- `successCriteria: [...]` — 2–5 **technology-agnostic, measurable** outcomes that define success for
  the scope (the WHAT/WHY, not the HOW). Example: "A user completes checkout in under 2 minutes."
- `roadmap` from the sizing above.
- `conventions: []` — populated later by `learner.md` during sprint retros.
- `clarifications: []` — populated by `clarify.md` when ambiguities are resolved.
- `activeSprint: null` — planning hasn't started yet.
- `handoff.nextAction`: `"clarify"` if any design-affecting unknown remains (write
  `[NEEDS CLARIFICATION: ...]` markers in `objective`/`successCriteria` rather than guessing),
  otherwise `"plan_sprint"`. `handoff.nextTaskId: null`.

Write to `.agents/kyro/scopes/{scope}/sprint.json` using the Artifact Write Contract in `../../SKILL.md`. Create `archive/` and `findings/` directories alongside it.

## Step 6 — Update kyro.json

**If `.agents/kyro/kyro.json` already exists:** add a scope **object** to `kyro.json.scopes[]` — exactly `{ "id": "{scope}", "title": "{title}", "status": "planning" }`, never a bare string (a string is v3 drift and `kyro doctor` will fail it). Set `activeScope` to this scope if none is active. Use the Artifact Write Contract (read → parse → mutate → overwrite whole file → re-parse).

**If `.agents/kyro/kyro.json` does NOT exist** (no prior `kyro install` in this harness): create it with the COMPLETE v4 shape — every required field, not just `scopes`/`activeScope`. A partial file (e.g. only `{ scopes, activeScope }`) is an *incomplete v4* that `kyro doctor` flags and that the agent-facing tools must repair. Write exactly:

```json
{
  "schemaVersion": 4,
  "artifactRoot": ".agents/kyro/scopes",
  "scopes": [{ "id": "{scope}", "title": "{title}", "status": "planning" }],
  "activeScope": "{scope}",
  "runtimeVersion": "4.0.0",
  "runtimePath": "~/.agents/kyro/current",
  "installedAdapters": []
}
```

After creating it, recommend running `kyro install` once so the adapter inventory (`installedAdapters`) and runtime paths are populated authoritatively.

**Optional — seed `principles[]`:** if the user states non-negotiable project rules, add them to
`kyro.json.principles[]` as objects `{ id, rule, severity, rationale, check? }`. Use a built-in
`check` (`tasks-have-acceptance-criteria`, `no-clarification-markers`, `success-criteria-present`)
when the rule maps to one, so `kyro analyze` enforces it deterministically.

## Output

Report: scope, work type, finding count, sprint count, sizing rationale, files created. Next action: run `/kyro:forge` to plan Sprint 1.

## Rules

- INIT writes exactly two files: `sprint.json` + updates `kyro.json`. Plus write-only `findings/`.
- Do not generate `state.json`, `index.json`, `ROADMAP.md`, `ROADMAP.summary.json`, `RE-ENTRY-PROMPTS.md`, `phases/`, or any v3 artifact.
- Do not generate the first sprint — that is `plan-sprint.md`'s job.
- Do not load sprint templates, debt tracker, execution modes, or unrelated analysis helpers during INIT.
