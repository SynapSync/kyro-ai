# INIT Mode — Scope Analysis & sprint.json Bootstrap

Use INIT when a scope has no `sprint.json`. Produces exactly two things: a new `sprint.json` and an updated `kyro.json`. Nothing else (besides write-only `findings/`).

## Inputs

- User request and current repository path.
- `.agents/kyro/kyro.json` if present (to know existing scopes).
- One work-type helper under `../helpers/analysis/` after work-type detection.
- **Optional:** if the user references a matured-idea document, consume its plan-grade sections using the exact schema-safe mapping in Step 5. For legacy briefs, fall back to `Problem / Motivation`, `Who it's for`, and `What success looks like`. Never re-interview the user for facts or decisions already captured there.

## Step 1 — Resolve scope

Determine `scope` (kebab-case work topic) and `codebasePath`. Output dir: `.agents/kyro/scopes/{scope}/`. If `sprint.json` already exists there, stop and route to `plan-sprint.md` instead.

## Step 2 — Detect work type

Classify as `feature`, `bugfix`, `audit`, `refactor`, `new-project`, or `tech-debt`. Load only the matching helper: `../helpers/analysis/{workType}.md`.

## Step 3 — Analyze

Read only what the work type requires. Write each distinct finding to `{outputDir}/findings/NN-slug.md` (summary, severity, affected files, recommendation) — write-only, never re-read to route.

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
- `successCriteria: [...]` — 2–5 **technology-agnostic, measurable** outcomes (WHAT/WHY, not HOW). Example: "A user completes checkout in under 2 minutes."
- `spec` (optional but preferred when the scope has explicit product/business requirements):
  - `requirements[]`: stable ids (`R1`, `R2`) with technology-agnostic statements, optional `priority` (`must|should|could`), and optional rationale.
  - `nonGoals[]`: explicit out-of-scope outcomes.
  - `openQuestions[]`: unresolved requirement-level questions that need `clarify.md`.
  - `scenarios[]`: start empty here unless the scenario is already unambiguous; `plan-sprint.md` normally adds Given/When/Then scenarios.
- `roadmap` from the sizing above.
- `conventions: []` (operational learned rules populated later by `learner.md`), `adrs: []` (durable architectural decisions, no markdown ADR files), `clarifications: []` (populated by `clarify.md`), `activeSprint: null`.
- `handoff.nextAction`: `"clarify"` if any design-affecting unknown remains (write `[NEEDS CLARIFICATION: ...]` markers rather than guessing), otherwise `"plan_sprint"`. `handoff.nextTaskId: null`.

**Plan-grade Seedbed mapping:** when a matured-idea document is referenced, load `../helpers/seedbed-init-mapping.md` and apply its exact schema-safe mapping. Account for every material item before writing. Do not load this helper on the normal one-line INIT path.

Write the completed document to `.agents/kyro/scopes/{scope}/sprint.json` using the Artifact Write Contract in `../../SKILL.md`: read the current target when present, serialize the complete v4 document, write atomically, then re-read and parse it before continuing. Create `archive/` and `findings/` beside it. Do not update `kyro.json` until this verification succeeds.

## Step 6 — Update kyro.json

**If `.agents/kyro/kyro.json` exists:** add a scope **object** to `kyro.json.scopes[]` — exactly `{ "id": "{scope}", "title": "{title}", "status": "planning" }` (never a bare string — `{{KYRO_CLI}} doctor` fails it). Set `activeScope` if none is active. Use the Artifact Write Contract.

**If it does NOT exist:** create it with the COMPLETE v4 shape — every required field, not just `scopes`/`activeScope` (a partial file is flagged by `{{KYRO_CLI}} doctor`). Write exactly:

```json
{
  "schemaVersion": 4,
  "artifactRoot": ".agents/kyro/scopes",
  "scopes": [{ "id": "{scope}", "title": "{title}", "status": "planning" }],
  "activeScope": "{scope}",
  "runtimePath": "~/.agents/kyro/current",
  "installedAdapters": []
}
```

After creating it, recommend the human run `npx kyro-ai install --scope workspace --yes` once (full npm package only — never via the projected runtime CLI). Day-to-day workflow still uses `{{KYRO_CLI}}`. The active runtime version is read from `~/.agents/kyro/current/manifest.json.packageVersion`, not copied into project state.

**Optional — seed `principles[]`:** if the user states non-negotiable project rules, add them to
`kyro.json.principles[]` as objects `{ id, rule, severity, rationale, check? }`. Use a built-in
`check` (`tasks-have-acceptance-criteria`, `no-clarification-markers`, `success-criteria-present`)
when it maps to the rule, so `{{KYRO_CLI}} analyze` enforces it deterministically.

## Output

Report: scope, work type, finding count, sprint count, sizing rationale, files created. Next action: run `/kyro:forge` to plan Sprint 1.

## Rules

- Write only `sprint.json` + `kyro.json` (plus write-only `findings/`). No other files.
- Do not generate the first sprint — that is `plan-sprint.md`'s job.
- Do not load sprint templates, debt tracker, execution modes, or unrelated analysis helpers during INIT.
