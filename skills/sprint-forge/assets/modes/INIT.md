# INIT Mode — Analysis, Roadmap & Scoped State

Use INIT when a scope has no Kyro roadmap yet. INIT creates human-readable evidence plus structured routing files so future commands do not reread everything.

## Inputs

- User request and current repository path.
- `.agents/kyro/kyro.json` if present.
- `../helpers/analysis-guide.md` for analysis strategy.
- Templates only when writing their artifact.

## Step 1 — Resolve scope

Determine:

| Field | Rule |
|-------|------|
| scope | Short kebab-case work topic, not the repo name. |
| codebasePath | Usually current working directory. |
| outputDir | Default `.agents/kyro/scopes/{scope}/`. |

If scope or output directory is ambiguous, ask once. Then create the scoped directory structure.

## Step 2 — Detect work type

Classify the request as audit/refactor, feature, bugfix, new project, or tech debt. If unclear, ask before analysis.

## Step 3 — Analyze

Use project search/read tools to inspect only what the work type requires:

- Audit/refactor: broad architecture and quality scan.
- Feature: integration points and missing behavior.
- Bugfix: reproduce, root cause, blast radius.
- New project: requirements and comparable patterns.
- Tech debt: debt indicators and cleanup targets.

Let evidence determine findings. Do not force a fixed category list.

## Step 4 — Write findings

Write each distinct finding to `{outputDir}/findings/NN-descriptive-slug.md`.

Each finding needs summary, severity, affected files, details, and recommendations. Use `analysis-guide.md` for the detailed format.

## Step 5 — Write roadmap

Load `../templates/ROADMAP.md` only now. Write `{outputDir}/ROADMAP.md` with:

- project paths
- finding-to-sprint map
- sprint dependencies
- sprint title/focus/type/version target
- suggested phases
- sprint summary table

## Step 6 — Scaffold human artifacts

Load templates only when writing:

- `../templates/PROJECT-README.md` → `{outputDir}/README.md`
- `../templates/REENTRY-PROMPTS.md` → `{outputDir}/RE-ENTRY-PROMPTS.md`

Create `{outputDir}/phases/` empty. Sprints are generated later.

## Step 7 — Write structured routing files

Create:

- `{outputDir}/state.json` from `../templates/state.json`
- `{outputDir}/index.json` from `../templates/index.json`
- `{outputDir}/ROADMAP.summary.json` from `../templates/ROADMAP.summary.json`

Initial values:

```json
{
  "status": "planning",
  "activeSprint": null,
  "currentPhase": "init",
  "nextAction": "plan_sprint"
}
```

Update `.agents/kyro/kyro.json` so `scopes` includes this scope and `activeScope` points to it when appropriate.

## Output

Report:

- scope
- work type
- number of findings
- planned sprint count
- files created
- next action: run `kyro-forge` to plan Sprint 1

## Rules

- `kyro install` never creates scoped `state.json`; INIT does.
- Markdown is durable evidence; JSON is the fast routing index.
- Do not load sprint templates, debt tracker, or execution modes during INIT.
- If the output directory already exists, ask whether to resume or choose a different scope.
