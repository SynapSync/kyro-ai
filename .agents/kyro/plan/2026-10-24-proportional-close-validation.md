# Plan — Proportional close validation (rev. 2 · APPROVED WITH NOTES by Astra)

Date: 2026-10-24 · Branch: `develop` (after `edf7f72`, validation tiers still Unreleased, so the
`validation.json` v1 shape can change without migration).

## Problem (measured, n=1 per variant)

Heavy-suite A/B on kyro-ai (`npm run check` = 84 serial steps, ~9 min), task HARN-02, Codex 6.1-sol:

| | Pre-tiers runtime (a768ecf) | Tiers runtime (edf7f72) |
|---|---|---|
| Sprint closed | 5.1 min | 12.9 min |
| Aggregate runs | 0 | 1 passing (+1 sandbox abort) |
| Validation time | 66 s | 557 s |

- The pre-tiers runtime has no stable policy: it put the aggregate in task criteria (history, small A/B)
  or skipped it entirely (here). Its final tree later passed the full suite (exit 0, 8m57s): the aggregate
  found nothing extra in this case. This does not prove focused selection catches every interaction.
- The tiers runtime made the aggregate a fixed ~9 min floor per sprint, even for one-task sprints.
- kyro-ai CI already runs `npm run check` on PRs to `main`/`develop` and pushes to `main`.

## Goal

Remove the universal per-sprint aggregate cost. Close validation becomes proportional to the change; the
aggregate runs at an explicit integration boundary (CI by default), and at close only when the project
requires it or the sprint touches high-impact paths. No silent weakening of explicit project policy.

## Design (rev. 2 — Astra plan review: all six changes adopted)

### 1. `validation.json` (v1, Unreleased shape change)

```json
{
  "validationVersion": 1,
  "task": [{ "id": "...", "paths": ["..."], "commands": ["..."] }],
  "fallback": ["npm run typecheck"],
  "close": ["npm run build"],
  "integration": ["npm run build", "npm run check"],
  "integrationBoundary": ".github/workflows/ci.yml job `validate` on PRs to main/develop",
  "escalate": ["src/cli/state.ts", "src/cli/artifacts/**", "package.json"]
}
```

- `close`: required at **every** sprint close, respected verbatim (an aggregate is allowed).
- `integration`: the aggregate suite, reported in packs and run at close only when escalated.
- `integrationBoundary`: string naming the existing mechanism that runs `integration` (workflow/job,
  pre-merge hook, release script), or `null`. Kyro neither runs nor verifies CI; this is a declaration.
- `escalate`: **minimum** deterministic high-impact patterns (same glob semantics as `task.paths`). Not
  an exhaustive definition of risk.
- All seven keys required (`[]`/`null` allowed). Invalid map → warning + `source: 'none'` (unchanged).

### 2. CLI: `validation.sprint` on scope packs

`kyro context-pack` (scope pack) adds `validation.sprint` when an active sprint exists. New repeatable
option `--sprint-file <path>` adds files found by git reconciliation **before** selection is computed.

- `files: [{ path, source: 'task' | 'evidence' | 'disposed-evidence' | 'reconciled' }]`:
  - `task`: `files_to_touch` of non-disposed tasks (phases + emergent);
  - `evidence`: evidence `files_changed` of non-disposed tasks;
  - `disposed-evidence`: evidence `files_changed` of disposed tasks (their pending intent is excluded, but
    partial changes may remain in the tree);
  - `reconciled`: `--sprint-file` paths (renames pass both old and new paths).
  Normalized, de-duplicated (first source wins, stable order).
- `commands` (configured, executable), in order, globally de-duplicated:
  1. rule commands for all files (declared rule order), then `fallback` if any file has no rule or the
     file set is empty;
  2. `close`;
  3. `integration` when escalated.
- `evidenceCandidates: [{ taskId, entries: string[] }]`: raw evidence `validation` lines. **Not**
  commands: the agent interprets them, keeps task-created checks that still apply to the final state, and
  verifies their current command before running.
- `uncoveredFiles`; `escalated` (= some file matched an `escalate` pattern, **not** "low risk" when
  false); `escalatedBy`; `integration`, `integrationBoundary` (always reported).
- `escalated` with `integration: []` → `escalationUnconfigured: true` plus a warning: no integration
  commands are configured, reasoned validation is required; the empty escalation is never presented as
  satisfied validation.
- Empty file set → fallback applies and a warning asks to reconcile with git.
- No map: `source: 'none'`, `files` and `evidenceCandidates` still computed, no configured commands.
- Task packs unchanged.

### 3. Policy (protocol + consumers)

Close tier, in order:

1. **Reconcile first.** Find the sprint's changes with git: working tree (`git status --porcelain`,
   untracked included) plus the sprint's commits (identify them, e.g. commits since the sprint's plan
   date or a known base, and state the method and residual uncertainty — a clean tree does not reveal
   committed changes). Pass missing paths (both sides of renames, new and deleted files) with
   `--sprint-file` and re-read the pack so rules, fallback, `uncoveredFiles` and escalation are recomputed
   on the corrected set.
2. Run `validation.sprint.commands` plus applicable task-created checks from `evidenceCandidates` and
   focused checks for `uncoveredFiles`. Reuse results whose tested state is still valid; rerun what later
   changes invalidated.
3. **Reasoned broadening still applies with a map**: cross-cutting changes outside `escalate` (shared
   types, public contracts, auth, dependencies, build/install) broaden up to `integration` with a stated
   reason. No map: select from criteria, diff and project scripts; broaden for high-impact changes or
   state the limitation.
4. Record in `close-sprint --note`: reconciliation method and uncertainty, what ran, what was reused,
   `uncoveredFiles`, escalation reasons, and the integration status — exactly one of **ran at close**,
   **satisfied by reused evidence** (with the tested-state reference), **deferred to
   `<integrationBoundary>`** (only when a named mechanism exists), **not configured** (`integration: []`;
   never satisfies an escalation, `escalationUnconfigured` and its warning stay), or **pending: no
   integration mechanism identified** (with the real boundary, e.g. before release).
5. Reconciliation is conservative, not an exact diff: `--sprint-file` only adds files; it does not drop
   unmaterialized intent or later-reverted changes, so selection may include extra checks. Commit
   selection by date is an approximation and must be stated as such.

Consumers: `close-sprint.md`, `qa-or-close.md`, `kyro-sprint-executor` (shared Close validation),
`plan-sprint.md` (DoD names close validation, not the aggregate, unless declared/escalated), docs,
CHANGELOG. Token budgets must hold with the protocol counted wherever it loads unconditionally.

### 4. `kyro analyze`

The aggregate-in-task-criteria heuristic uses `integration` commands plus explicit phrases. Commands also
used by task rules or `fallback` are never flagged. Membership in `close` does **not** suppress the
warning (requiring the aggregate at close does not justify requiring it per task). Advisory only.

### 5. kyro-ai dogfood map

`close: ["npm run build"]`, `integration: ["npm run build", "npm run check"]`, `integrationBoundary`:
`.github/workflows/ci.yml` job `validate` (runs `npm run check` on PRs to main/develop and pushes to main),
`escalate`: `src/cli/state.ts`, `src/cli/fs.ts`, `src/cli/artifacts/**`, `src/cli/checkpoints/**`,
`src/cli/pipeline/**`, `src/cli/adapters/**`, `src/cli/install-plan.ts`, `package.json`,
`package-lock.json`.

## Verification

- `check:validation-tiers` additions:
  - file union by source; disposed task residual `files_changed` included as `disposed-evidence`;
  - `--sprint-file` reconciliation that **adds a file triggering escalation** (docs-only Kyro state +
    reconciled `src/cli/state.ts` → `escalated`, `integration` in commands, `escalatedBy` updated);
  - narrative evidence (`"Ran npm test and it passed"`) appears only in `evidenceCandidates`, never in
    `commands`;
  - command order/dedupe; explicit aggregate in `close` respected;
  - escalation off: `integration` absent from `commands`;
  - `escalate` matched + `integration: []` → `escalationUnconfigured` + warning;
  - empty sprint file set → fallback + reconcile warning;
  - no-map and invalid-map packs; `integrationBoundary` required (nullable);
  - analyze: `close: ["npm run check"]` + `integration: ["npm run check"]` + task criterion naming it →
    still flagged;
  - consumer references and executor Close validation.
- **Detection probes** (bounded acceptance of the dogfood map, not a general coverage proof). In a
  disposable kyro-ai copy, for each probe: (1) healthy tree — selected commands pass; (2) mutation — at
  least one selected command fails **for the expected behavior** (assert the failing check and its
  message; build/compile errors and sandbox `EPERM` do not count); (3) restore — selected commands pass.
  Probes:
  - layered state (`state.ts`, escalates);
  - adapter projection (`adapters/`, escalates);
  - Work store (`work/`, no escalation, focused selection);
  - cross-module break **without escalation** (a shared helper outside `escalate` consumed elsewhere);
  - ordinary docs/skills change: assert the aggregate is **not** selected.
- Focused checks during implementation; `npm run build && npm run check` once at the end.

## Out of scope

- Parallelizing kyro-ai's `npm run check` (separate plan with serial vs 2/4-worker measurement and
  load-sensitive checks such as `check:lossless-checkpoints` kept exclusive).
- Persisting a sprint-start revision for an exact diff (schema change); agents reconcile with git.
- Work lifecycle close selection (Work keeps its own rule).

## Detection probe results (2026-10-24, disposable copy, runner `~/.cache/kyro-tmp/probes/run.mjs`)

Each probe: healthy selection passes → mutation fails a selected command on the expected behavior (not a
compile/sandbox error) → restore passes.
The runner checks the expected check **and** message per probe and exits non-zero on any miss, invalid or
unexpected detection, healthy/restore failure, or a docs probe selecting the aggregate (verified: removing
the `core` rule makes it exit 1). Results: `~/.cache/kyro-tmp/probes/probe-results.json`.

| Probe | File | Escalated | Detected by | Restore |
|---|---|---|---|---|
| layered state | `src/cli/state.ts` | yes | `check:layered-state` ("principles must come from shared") | pass |
| adapter projection | `src/cli/adapters/command-skills.ts` (CRLF normalization removed) | yes | `check:adapters` (CRLF owned projections) | pass |
| Work store | `src/cli/work/store.ts` (revision check disabled) | no | `check:work-plan` (Work rule; assertion failure) | pass |
| cross-module, no escalation | `src/cli/core/task-graph.ts` (`dependencyCycle` → `[]`) | no | `check:active-plan` (cyclic active plan accepted) | pass |
| ordinary docs | `docs/cli.md` | no | selection only: 3 commands, aggregate **not** selected | — |

- **Map gap found and fixed:** the first cross-module probe showed `src/cli/core/**` had no rule (fallback
  build/typecheck only). Added rule `core` (`src/cli/core/**`, `src/cli/routing.ts` → build,
  `check:active-plan`, `check:status`, `check:analyze-metadata`, `check:close-handoff`, `check:eval`).
- **Suite coverage debt (not a selection gap):** mutating `deriveScopeStatus` in `src/cli/core/status.ts`
  (`blocked` with handoff blockers → `active`) passes the **entire** `npm run check` (84 steps, per-step exit codes in
  `~/.cache/kyro-tmp/probes/status-mutant-steps.tsv`, mutation diff in `status-mutant.diff`). The `completion ||` mutation is likely equivalent (completion and `nextAction: done` move
  together). Follow-up: add a status regression covering blocked/completed derivation.
- Bounded acceptance of the dogfood map only — not a general coverage proof and not a measured saving.
