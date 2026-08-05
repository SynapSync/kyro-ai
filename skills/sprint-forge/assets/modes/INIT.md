# INIT Mode — Scope Analysis & sprint.json Bootstrap

Use INIT when a scope has no `sprint.json`. Produces exactly one artifact you write: a new `sprint.json` (besides write-only `findings/`). Project state (`project.json`/`local.json`) is registered by `{{KYRO_CLI}} plan`, not by you. Nothing else.

## Inputs

- User request and current repository path.
- `.agents/kyro/project.json` if present (to know existing scopes).
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
- **Do not invent `author`.** Scope creator identity is machine-captured only by `{{KYRO_CLI}} plan` from git `user.name` and/or `user.email` when at least one is set. Hand-writing `sprint.json` never captures it — see the mandatory path below.

**Plan-grade Seedbed mapping:** when a matured-idea document is referenced, load `../helpers/seedbed-init-mapping.md` and apply its exact schema-safe mapping. Account for every material item before writing. Do not load this helper on the normal one-line INIT path.

**Mandatory: materialize `sprint.json` via the CLI, not by hand.** Write a compact lean plan JSON (`scope`, `title`, `objective`, `successCriteria`, `spec`, `roadmap` — **no `author` field**) and run `{{KYRO_CLI}} plan --from <file>`. This is tool-owned and validated: it materializes `sprint.json` (including optional `author` captured from git when available) and registers the scope in `project.json`/`local.json` for you — skip straight to Step 6's verification. The startup capability handshake (`{{KYRO_CLI}} capabilities --json`, Step 0 of `../../SKILL.md`) already confirms `plan` is supported before INIT ever runs, so there is essentially never a legitimate reason to skip this.

If `{{KYRO_CLI}} plan --from <file>` returns a validation error (e.g. `INVALID_INPUT`, `INVALID_SPRINT_SHAPE`), **fix the lean plan JSON and retry the CLI** — do not fall back to hand-writing. Hand-writing `sprint.json` directly is a **recovery-only fallback**, reserved for when the CLI genuinely cannot run (`UNKNOWN_COMMAND`, missing binary, crash) — never a routine choice. On that narrow fallback, hand-write the document without inventing `author`.

Write the completed document to `.agents/kyro/scopes/{scope}/sprint.json` using the Artifact Write Contract in `../../SKILL.md`: read the current target when present, serialize the complete v4 document, write atomically, then re-read and parse it before continuing. Create `archive/` and `findings/` beside it. Do not touch project state until this verification succeeds.

## Step 6 — Verify project state (do not hand-write it)

`{{KYRO_CLI}} plan --from <file>` already registered the scope. It writes the layered project state
for you: the scope object `{ "id": "{scope}", "title": "{title}", "status": "planning" }` goes into
`.agents/kyro/project.json` under `scopes[]`, and `activeScope` goes into `.agents/kyro/local.json`
when none is active. **Verify, do not re-create.**

Read `.agents/kyro/project.json` + `.agents/kyro/local.json` and confirm the scope is present and
active. If either file is missing, project state was never bootstrapped — tell the human to run
`npx kyro-ai install --scope workspace --init-workspace --yes` once (full npm package only, never
via the projected runtime CLI), then retry. Do not hand-author these files to paper over it.

The active runtime version is read from `~/.agents/kyro/current/manifest.json.packageVersion`, not
copied into project state.

**Optional — seed `principles[]`:** if the user states non-negotiable project rules, add them to
`project.json.principles[]` as objects `{ id, rule, severity, rationale, check? }`. Use a built-in
`check` (`tasks-have-acceptance-criteria`, `no-clarification-markers`, `success-criteria-present`)
when it maps to the rule, so `{{KYRO_CLI}} analyze` enforces it deterministically.

## Output

Report: scope, work type, finding count, sprint count, sizing rationale, files created. Next action: run `/kyro:forge` to plan Sprint 1.

## Rules

- Write only `sprint.json` (plus write-only `findings/`). Project state (`project.json`/`local.json`) is written by the CLI, not by you. No other files — no `README.md`, no getting-started guides, no scope-level Markdown of any kind.
- Do not generate the first sprint — that is `plan-sprint.md`'s job.
- Do not load sprint templates, debt tracker, execution modes, or unrelated analysis helpers during INIT.
