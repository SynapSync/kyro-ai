# INIT Mode — Lean Analysis, Roadmap & Scoped State

Use INIT when a scope has no Kyro roadmap. Optimize for justified sprint boundaries, not fewer sprints.

## Inputs

- User request and current repository path.
- `.agents/kyro/kyro.json` if present.
- One work-type helper under `../helpers/analysis/` after routing.
- Templates only when writing their artifact.

## Step 1 — Resolve scope

Determine `scope`, `codebasePath`, and `outputDir` (`.agents/kyro/scopes/{scope}/`). If scope or output directory is ambiguous, ask once. If the output directory exists, ask whether to resume or choose a different scope.

## Step 2 — Detect work type

Classify as `feature`, `bugfix`, `audit`, `refactor`, `new-project`, or `tech-debt`. Load only the matching helper:

```text
../helpers/analysis/{workType}.md
```

## Step 3 — Analyze

Use project search/read tools only for the detected work type. Let evidence determine findings. Do not force category counts or split work by labels alone.

## Step 4 — Write findings

Write each distinct finding to `{outputDir}/findings/NN-descriptive-slug.md` with summary, severity, affected files, details, recommendation, and validation.

## Step 5 — Decide sprint sizing

Before writing the roadmap, produce `sizingDecision`:

```json
{
  "recommendedSprintCount": 1,
  "riskLevel": "low | medium | high",
  "rationale": "...",
  "splitTriggers": [],
  "whyNotFewer": "...",
  "whyNotMore": "...",
  "sprintProofs": []
}
```

Consistency rules: count must match planned sprints; `sprintProofs.length` must match count; every sprint needs one proof; multi-sprint plans need non-empty `splitTriggers`; `whyNotFewer` and `whyNotMore` cannot be empty.

## Step 6 — Write artifacts

Load templates only when writing:

- `../templates/ROADMAP.md` with paths, `sizingDecision`, dependency map, sprint summary, and sprint definitions.
- `../templates/PROJECT-README.md` for scope overview.
- `../templates/REENTRY-PROMPTS.md` for summary-first recovery.

Create `{outputDir}/phases/` empty.

## Step 7 — Write structured routing files

Create `state.json`, `index.json`, and `ROADMAP.summary.json`. Include `sizingDecision` in `index.json` and `ROADMAP.summary.json`. Update `.agents/kyro/kyro.json` with the scope and activeScope when appropriate.

## Output

Report scope, work type, finding count, sprint count, sizing rationale, files created, and next action: run `kyro-forge` to plan Sprint 1.

## Rules

- `kyro install` never creates scoped `state.json`; INIT does.
- Markdown is durable evidence; JSON is the fast routing index.
- Do not load sprint templates, debt tracker, execution modes, or unrelated analysis helpers during INIT.
