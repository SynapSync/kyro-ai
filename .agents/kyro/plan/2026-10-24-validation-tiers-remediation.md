# Plan — Validation tiers remediation (rev. 2 · APPROVED WITH NOTES by Astra)

Date: 2026-10-24 · Branch: `develop` (uncommitted validation-tiers change).
Sources: Astra code review `/tmp/kyro-validation-audit-e2m6qz55/REVIEW.md` (+ `audit-probes.cjs`, all
reproduced locally) and Astra's plan review of rev. 1 (CHANGES REQUIRED; every requested change adopted below).

## Triage

| ID | Finding | Decision |
|----|---------|----------|
| F1 | One mapped file suppresses fallback for unmapped files | **Fix (P1)** |
| F2 | Paths/patterns truncated at first whitespace → false matches | **Fix** |
| F3 | Standalone executor: no close validation on direct `close_sprint`; no fallback without a map | **Fix** |
| F4a | `All tests in test/domain.test.js pass` flagged as aggregate | **Fix** |
| F4b | `npm run check passes` not flagged without a map | **Not a requirement (accepted by Astra)** — unmapped projects get phrase detection only; keep a test documenting the limit |
| F5 | Task rule forbids `validation.close` although `npm run build` is in both tiers | **Fix wording** |
| P1 | Absolute rules | **Fix** — defaults with stated exceptions; no rule may override a live criterion |
| P2 | Evidence freshness undefined; `mtime`/`reviewedMaterialDigest` are not proof | **Fix** — correspondence-based reuse (below) |
| P3 | Omitted `close` collapses to `close: []` | **Fix** — `close` required in a valid map |
| D1 | Diagnosis overstated | **Fix text** (figures below) |
| D2 | `check:dist` runs after dist consumers | **Fix** — move right after `typecheck` |
| D3 | 143 vs 150 tasks | **Reconciled**: my filter `'checkpoint' in path` dropped the whole `managed-checkpoint-path-safety` scope. Correct: **150 tasks, 44 with aggregate mentions (29%), 66 with build**, 28 archives |

## 1. Resolver (`src/cli/core/validation.ts`, types)

- **Selection:** commands of every matching rule in declared rule order, then `fallback` if any task file
  matched no rule; global de-duplication preserving first occurrence.
- **`validation.uncoveredFiles`:** task files with no matching rule, reported even when `fallback` is empty.
  It means "no rule", never "validated".
- **Empty task file list:** `task` = fallback, `uncoveredFiles: []`; not a claim of full coverage.
- **Scope packs:** `task: []`, `uncoveredFiles: []`, `close` only; no synthetic files.
- **Absent map** is a normal informational state (`source: 'none'`, no warning). Warnings are reserved for
  invalid configuration or insufficient coverage.
- **Uncovered + empty fallback:** pack carries `uncoveredFiles` and a warning; agents must choose focused
  checks themselves — an empty command list is never validation.
- **Paths:** configured patterns are used verbatim. Task-file annotation stripping only removes a recognized
  trailing marker: ` (new)`, ` (created)`, ` (modified)`, ` (deleted)`, ` (removed)`, ` (renamed)`
  (case-insensitive). Any other parenthesized suffix is part of the file name.
- **Map validity:** `validationVersion`, `task`, `fallback`, `close` all required (arrays may be empty).
  `close: []` = project explicitly declares no aggregate suite. Invalid map → pack warning,
  `source: 'none'`; missing or invalid map → agents use the project's full check at close.
- **Aggregate heuristic:** drop bare `all tests`; keep explicit full/entire/whole/complete/aggregate
  suite/check phrases, "suite completa", and map `close` commands not used by task rules or fallback.

## 2. Policy text

Single detailed source: `sprint-forge/assets/protocols/validation.md`. Each consumer keeps a one-line
inline rule (so the essential behavior survives even if the protocol is not opened) plus an explicit
"load `protocols/validation.md` when broadening, reusing evidence, or closing" instruction:
`execute-task.md`, `review-task.md`, `close-sprint.md`, `qa-or-close.md`, `delegates/implementer.md`,
`delegates/checker.md`, `kyro-sprint-executor/SKILL.md` (runtime path), `organic-work/SKILL.md`.
A check asserts every consumer carries the reference (string presence is necessary, not sufficient; the
token-budget audit confirms the routed load set).

Protocol content:
- **Task tier:** focused by default (`validation.task` + checks for `uncoveredFiles`). Broaden — up to the
  aggregate — when the task changes cross-cutting contracts (shared types, build/packaging, install,
  wiring); state the reason in evidence `--notes`. **Avoid redundant aggregate runs; broaden when justified.**
- **Live criteria win:** a criterion in force must be satisfied (reusing valid evidence first) or receive an
  explicit exception through the authorized flow (`plan --update-active` / waiver). An unnecessary criterion
  is corrected through that flow, never silently skipped.
- **Expensive proofs** (mutation, byte-identical, package/install): run when the criteria or the contract
  under change require them, or when `context` says `High risk:`; not by default.
- **Evidence reuse (checker):** reuse when the evidence records the command, a passing result, and a
  verifiable reference to the tested state, and the relevant inputs of that validation have not changed
  since it ran. Acceptable references: a clean identified revision captured **at test time**
  (`git rev-parse HEAD` with clean `git status --porcelain`) and compared with the current state, or the
  same session with verifiable absence of relevant changes since the run (including other agents/processes). `mtime` and
  `reviewedMaterialDigest` (task metadata/evidence only, not source contents) are not sufficient proof.
  If correspondence cannot be established, rerun the affected focused checks (cheap by design).
- **Close tier:** run `validation.close` (map absent/invalid → project full check; `close: []` → none) once
  per sprint. Reuse a passing run only on the same relevant state; rerun when a remediation invalidates its
  relevant inputs (administrative-only changes do not).

## 3. Standalone executor

One "Close validation" step referenced from both `qa_or_close` and direct `close_sprint`, with the
absent/invalid-map fallback, `close: []` semantics, and same-state reuse rule.

## 4. `package.json`

Move `check:dist` immediately after `typecheck` in `check`.

## 5. Text corrections

- `2026-10-24-validation-tiers.md` "Problem": 150 tasks / 44 aggregate mentions (29%) / 66 build;
  mentions in evidence are not distinct executions; 44 × 538 s is an arithmetic illustration under stated
  assumptions, **not** a bound or measured cost; "tests are the main bottleneck" is a hypothesis supported
  by criteria/plan evidence; the A/B shows behavior change, not time savings.
- `docs/validation-tiers.md`: selection order, `uncoveredFiles`, annotation markers, required `close`,
  empty vs absent semantics, broaden-with-reason, live-criteria rule, evidence-reuse definition.
- CHANGELOG Unreleased entry updated accordingly.

## Tests (`scripts/check-validation-tiers.mjs`)

- Mixed covered + uncovered → rule commands then fallback, deduped; `uncoveredFiles` exact.
- Overlapping rules; command shared by a rule and fallback appears once at its first position.
- Empty file list → fallback, `uncoveredFiles: []`; empty fallback + uncovered → warning, `task` only rule commands.
- Scope pack → `task: []`, `uncoveredFiles: []`.
- Pattern with spaces matches only its directory; `(new)` stripped; `docs/guide (v2).md` preserved.
- Normalizations kept: `./src/a.ts` and `src\\a.ts` still match `src/**`; `docs/guide (draft)` (parenthesized
  name at the very end) preserved.
- Map: absent (no warning), invalid JSON, omitted `close` (invalid → warning, `source: 'none'`), explicit `close: []` (valid).
- Heuristic: `All tests in test/x.test.js pass` → no finding; "full test suite" → finding;
  `npm run check passes` without a map → no finding (documented limit).
- Policy consumers: each listed file references `protocols/validation.md`; executor's both close paths
  reference close validation.
- Astra probes F1, F2, F4a replayed as regressions.

## Validation

- Focused: `npm run build`, `check:validation-tiers`, `check:analyze-metadata`, `check:token-budgets`,
  `check:budget-manifest`, `check:command-modes`, `check:qa-or-close`, `check:startup-contract`,
  `check:links`, `check:no-placeholder`, `check:mcp`, `check:eval`, `check:dist`.
- Once at the end: `npm run build && npm run check`.
- Astra's `audit-probes.cjs`: F1, F2, F4a pass; F4b remains a documented non-goal.

## Out of scope

Work `context-pack` suggestions; recording tree references automatically in `record-evidence`
(candidate follow-up); review/evidence merge; heavy-suite benchmark (after this lands).
