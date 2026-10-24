# Plan — Validation tiers and suggested task validation

Date: 2026-10-24 · Branch: `develop` · Origin: bottleneck analysis of 150 archived Forge tasks.

## Problem (corrected 2026-10-24 after Astra review)

- 150 archived Forge tasks (28 archives, 12 scopes); **44 (29%) mention the aggregate `npm run check`** and
  66 mention `npm run build` in their evidence. Mentions are not distinct executions: some evidence cites
  earlier runs, some chains failed early. 44 × 538 s ≈ 6.6 h is an arithmetic illustration under those
  assumptions, not a measured cost or a bound. (An earlier count of 143/43 dropped the
  `managed-checkpoint-path-safety` scope through a path filter bug.)
- `npm run check` is 83 serial steps (~538–549 s measured on this machine).
- Plans write the aggregate suite into task acceptance criteria and sprint DoD, and `kyro review`
  auto-checks every criterion, so the agent must satisfy it per task.
- Nothing tells an agent which checks belong to the files it touched.
- 37 of 147 traced reviews were `fail`. The evidence→review interval only measures two writes; it does not
  prove absent independent review or duplicated work.
- "Tests are the main bottleneck" is a hypothesis supported by plan/criteria evidence, not a measurement.
  The A/B run showed a behavior change (aggregate suite moved out of task criteria), not time savings.

## Goal

Run the aggregate suite **once per sprint (at close)**, and give each task a deterministic, focused
validation list without weakening maker/checker or evidence contracts.

## Design

### 1. Validation tiers (skill contract)

| Tier | When | What |
|------|------|------|
| task | execute/review | Focused checks for `taskFiles` (pack `validation.task`), typecheck/build only if touched code needs it |
| close | `qa_or_close` / `close_sprint` | Aggregate suite once (pack `validation.close`) |

- Plan: task `acceptance_criteria` must describe behavior + a focused check; never the aggregate suite.
  The aggregate suite belongs only in `definitionOfDone`.
- Expensive proofs (mutation/revert, byte-identical history, pack/tarball/install) only when the task
  `context` declares `High risk:`.
- Checker trusts passing recorded mechanical evidence; re-runs only when evidence is weak, the material
  changed after evidence, or the task is high risk.

### 2. `.agents/kyro/validation.json` (optional, project-owned)

```json
{
  "validationVersion": 1,
  "task": [{ "id": "adapters", "paths": ["src/cli/adapters/**"], "commands": ["npm run build", "npm run check:adapters"] }],
  "fallback": ["npm run typecheck"],
  "close": ["npm run build", "npm run check"]
}
```

- `kyro context-pack` emits `validation: { source, task, matchedRules, close, issues }`. Task packs map
  `taskFiles` to rules (glob `*`, `**`, `?`, or directory prefix); no match → `fallback`.
- Invalid file → pack warning + MEDIUM analyze finding; never blocks routing.

### 3. `kyro analyze` advisory finding

- MEDIUM `validation-tier` finding when a task criterion names a `close` command or an aggregate-suite
  phrase. Advisory only: never blocks close, never feeds the review veto.

## Tasks

1. Types + `src/cli/core/validation.ts` (load/validate/match). 
2. `context-pack` `validation` field (CLI + MCP share `buildContextPack`).
3. `analyze` advisory finding.
4. Skill text: plan-sprint, sprint-generator, execute-task, review-task, checker, reviewer, close-sprint,
   qa-or-close, orchestrator, protocols/validation, kyro-sprint-executor.
5. Dogfood `.agents/kyro/validation.json` for kyro-ai; `docs/validation-tiers.md`; CHANGELOG Unreleased.
6. `scripts/check-validation-tiers.mjs` wired into `check`.

## Validation (practising the new policy)

- Per task: `npm run build` + `check:validation-tiers` + checks for touched contracts
  (context-pack/analyze/token budgets/budget manifest/links/command-modes).
- Once at the end: `npm run build && npm run check`.

## Measurement

Codex runs a small TODO-app scope through Kyro Forge in a disposable directory with the new runtime and
reports wall time per phase, CLI calls (trace), validations per task and aggregate runs.

## Out of scope

Work (`kyro work context-pack`) suggested validation, stale-`dist` guard, review/evidence merge.
