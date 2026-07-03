# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.9.0] - 2026-07-03

Adds minimal spec traceability inside `sprint.json`.

### Added

- Optional `spec` block with requirements, scenarios, non-goals, and open questions.
- Optional `task.scenario_refs` links for Requirement → Scenario → Task traceability.
- Deterministic `kyro analyze` findings for broken spec references, duplicate ids, coverage gaps, open questions, and done/pass tasks without scenario references.
- Spec traceability reporting in `doctor --adapters`.
- Context-pack output for scope-level spec details and task-level resolved scenarios.
- `check:spec-traceability`, eval fixtures, and `docs/spec-traceability.md`.

## [4.8.0] - 2026-07-02

Adds a deterministic maker/checker boundary for task evidence and verdicts.

### Added

- Typed task evidence and verdict contracts with tolerant checker validation.
- `kyro review <task>` tool-owned verdict writer with confirmation guard, safe write, handoff updates, and trace events.
- Checker findings in `kyro analyze` for missing evidence/verdict, criteria coverage drift, non-negotiable principle pass violations, verdict/evidence timestamp order, and optional self-review blocking.
- `maker_checker.requireSeparateChecker` policy extension.
- Maker/checker boundary reporting in `doctor --adapters`.
- `check:maker-checker` gate and eval fixtures for happy-path review and blocked self-review.
- `docs/maker-checker.md`.

### Changed

- `close-sprint` now refuses to close while CRITICAL/HIGH analyze findings remain.
- Sprint execution/review mode docs now route verdict writes through `kyro review`.

## [4.7.0] - 2026-07-02

Adds portable guardrail policy enforcement for dangerous operations across CLI and MCP surfaces.

### Added

- Built-in guardrail policy with fail-safe `.agents/kyro/policy.json` overrides.
- Shared `evaluateGuard` core for guarded operations.
- `POLICY_BLOCKED` error code and CLI error-code rendering.
- `check:guardrails` gate covering zero-write refusals, confirmation, fail-safe merge, trace, and MCP projection.
- Adapter guardrail enforcement-tier reporting in `doctor --adapters`.
- Codex MCP config projection for `kyro mcp serve`.
- Eval cases for `scope set-active` confirmation and blocked policy behavior.
- `docs/guardrails.md`.

### Changed

- `kyro scope set-active` now requires explicit `--yes` confirmation.

## [4.6.0] - 2026-07-02

Adds append-only trace events for per-scope observability without making trace a source of truth.

### Added

- `kyro trace` command with `--json`, `--tail`, `--type`, and explicit-scope `--clear`.
- `doctor --trace` informational trace summaries.
- Append-only best-effort trace core with `KYRO_TRACE=0` kill switch and `KYRO_TRACE_DEBUG` diagnostics.
- Seven-versioned trace event catalog and golden drift check.
- `check:trace` conformance gate for append-only writes, non-fatal failures, stdout purity, NDJSON validity, crash-tolerant reads, and no routing reads.
- Eval cases pinning `close_snapshot` emission and trace kill-switch behavior.
- `docs/trace.md` with trace-vs-ledger disambiguation.

### Changed

- Eval replay steps now support scoped environment variables for behavioral checks.

## [4.5.0] - 2026-07-02

Adds a tools-only MCP typed tool surface over Kyro's deterministic CLI core.

### Added

- `kyro mcp serve` stdio server with JSON-RPC lifecycle, tools/list, tools/call, ping, protocol negotiation, and stdout purity.
- `kyro mcp tools` for printing the tool catalog.
- Seven typed MCP tools: `context_pack`, `doctor_artifacts`, `analyze_scope`, `close_sprint`, `scope_list`, `scope_inspect`, `repair_scope`.
- Shared core layer for scope resolution, analysis, scope listing, and structured `KyroCoreError` envelopes.
- Two-phase mutation protocol for MCP mutations: dry-run plan by default, apply only with `confirm: true`.
- `check:mcp` conformance gate and `fixtures/mcp/tool-catalog.golden.json`.
- `docs/mcp.md` with host registration examples.

### Changed

- `kyro analyze` now uses the shared analysis core; CLI behavior remains pinned by evals.
- `close-sprint` double-close errors now expose the stable `SNAPSHOT_EXISTS` code.

## [4.4.0] - 2026-07-02

Adds deterministic behavioral evals for agent-facing Kyro contracts.

### Added

- `kyro eval` command with strict `case.json` manifests, isolated temp sandboxes, route assertions, CLI step expectations, final-state normalization, human output, and `--json` reports.
- `fixtures/evals/` seed suite with 15 replay cases covering all routes, known guardrail failures, close-sprint happy path, task-mode context packs, and adapter filtering.
- `check:eval` and `check:eval-harness` regression gates, now included in `npm run check`.
- Code-owned routing contract (`src/cli/routing.ts`) plus `check:routing` to prevent drift between `agents/orchestrator.md` and runtime route resolution.
- `context-pack --json` now includes `routing.modes` for machine-checkable route assertions.

### Changed

- `agents/orchestrator.md` now documents the `clarify` route explicitly.

## [4.3.0] - 2026-07-01

Documentation audit, bug fixes, and token optimization. Eliminates all artifact model drift and
removes stale forward-looking docs.

### Fixed

- **Critical (schema/runtime contract):** `kyro doctor --artifacts` now validates every field the
  runtime consumes from `activeSprint` (`objective`, `definitionOfDone`, `phases[].id/title`,
  `tasks[].title`) and from `roadmap.sprints[]` (`n`, `slug`, `title`, `state`). Previously an
  incomplete `sprint.json` could PASS the doctor and then crash `close-sprint`. Regression fixtures
  added. Contract: if the doctor says PASS, no downstream command may crash on a missing field.
- **Critical:** `kyro analyze` error message no longer references the removed `kyro migrate` command.
- **High:** `package-lock.json` was stale (pinned 3.4.3); regenerated at the release version and now
  enforced by `check:versions`. Removed the non-canonical `pnpm-lock.yaml` (CI uses `npm ci`).
- **High:** 10 documentation files rewritten to reflect the `sprint.json`-only model; eliminated all
  references to pre-4.0 artifacts (`state.json`, `index.json`, `ROADMAP.md`, `events.ndjson`, `phases/`).
- Docs no longer reference removed scripts (`check:artifact-fixtures`, `check:context-pack`) in
  `cli.md`, `release-checklist.md`, and `cost-model.md`.
- `KYRO_WORKFLOW.stateModel` public export corrected from `markdown` to `sprint-json`.
- Removed dead `checkTemplateBudget` helper; strict `tsc --noUnusedLocals --noUnusedParameters` is clean.

### Removed

- `docs/harness-migration.md` — described v4.x features (CLI runtime, install, doctor, sync) as
  future work; no longer needed.
- Historical v3.4.0 release notes — shipped as `docs/releases/` but not relevant to current users.

### Changed

- Trimmed `INIT.md` (623w → 526w, −97w) and `close-sprint.md` (610w → 529w, −81w) for runtime
  efficiency; gates and safety contracts preserved.
- Runtime token budgets now have tighter but sustainable margins across all paths.

## [4.2.0] - 2026-06-30

Kyro is now a single-model tool: everything is `sprint.json`. Internal cleanup plus a repaired
release pipeline.

### Removed

- **`kyro migrate` command.** Kyro reads and writes only the `sprint.json` model; there is no
  separate conversion step.

### Fixed

- Repaired the CI `validate` pipeline (build now runs before the checks; removed references to
  scripts that no longer exist) so tags publish cleanly again.

### Changed

- Recalibrated runtime token budgets to the real footprint of the lean runtime, with ~10% headroom;
  they remain a meaningful ceiling that flags a mode/helper growing too large.
- Renamed the runtime verification gate to `check:runtime-artifacts` (runtime must reference only the
  `sprint.json` model).

## [4.1.0] - 2026-06-30

Adds the **input discipline** that the v4 execution engine lacked, borrowing the proven mechanisms
from spec-kit but keeping Kyro's single-source-of-truth model. The rule throughout: what must happen
is enforced deterministically by the CLI, not left to prose a weak model can ignore.

### Added

- **Clarify discipline.** A new `clarify` mode and `handoff.nextAction` resolve ambiguity before
  planning (≤5 questions, one at a time, recommended option first), recording each answer in
  `sprint.json.clarifications[]`. Agents write `[NEEDS CLARIFICATION: ...]` instead of guessing, and
  `kyro doctor --artifacts` **fails** while any such marker remains — a deterministic gate that works
  in any harness.
- **`kyro analyze`** — semantic cross-check of a scope (where `doctor` checks shape, `analyze` checks
  meaning). Severity-triaged findings (CRITICAL/HIGH/MEDIUM/LOW): unresolved clarifications, coverage
  gaps, missing acceptance criteria, broken `depends_on`, overdue debt, principle violations. Exits
  non-zero on CRITICAL/HIGH. Gate before `close_sprint`. `--json` supported.
- **Project-level principles.** `kyro.json.principles[]` (authored, immutable — spec-kit's
  "constitution"), distinct from learned `conventions[]`. Each `{ id, rule, severity, rationale,
check? }`; principles with a built-in `check` are enforced deterministically by `kyro analyze`,
  free-text ones are agent gates at `plan-sprint`/`review-task`.
- `successCriteria[]` on `sprint.json` — technology-agnostic, measurable outcomes (the WHAT/WHY layer).

### Changed

- `INIT` seeds `successCriteria[]` and (optionally) `principles[]`; `plan-sprint` and `review-task`
  enforce clarity and principle gates before advancing.
- The `sprint.json` template carries `successCriteria`, `clarifications`, and the previously missing
  `activeSprint.title`.

## [4.0.0] - 2026-06-30

Major release. Kyro adopts a single source of truth per scope — `sprint.json` — and makes the
irreversible operations (sprint close, narrative rendering) tool-owned and deterministic instead of
agent-rendered prose.

### Highlights

- **Single source of truth.** Each scope is one `sprint.json` plus the global `kyro.json`
  registry. Agents read two files and route on `handoff.nextAction`.
- `kyro.json.scopes[]` entries are objects `{ id, title, status }`, never bare strings.

### Added

- **`kyro close-sprint`** — deterministic, zero-loss sprint close. Writes the verbatim JSON snapshot
  to `archive/` **before** clearing `activeSprint`, renders the human narrative `.md` (title sourced
  from `roadmap.sprints[]`, so it can never be `undefined`), appends the `ledger[]` entry, updates
  `previousSprint`/`roadmap`/`handoff`, and flips the `kyro.json` scope status on the last sprint.
  Refuses to run if a snapshot already exists (double-close protection). New `--learning` flag.
- **PreToolUse guard** (Claude Code) that blocks any hand edit nulling `activeSprint`, redirecting to
  `kyro close-sprint`.
- **`kyro doctor --artifacts`** now audits zero-loss snapshots, archive narratives (catches
  `Sprint N: undefined`), `activeSprint.title`, and non-object task `evidence`.
- Runtime-artifact verification gate and doctor fixtures wired into `npm run check`.

### Changed

- Runtime (orchestrator, commands, modes, helpers) and the CLI both speak only the `sprint.json`
  model.
- Sprint narratives are rendered by the CLI, not hand-written by the agent.
- `activeSprint` now carries `title`, making each snapshot self-contained.
- `INIT` creates a complete v4 `kyro.json` when none exists (all required fields, not just
  `scopes`/`activeScope`).

### Fixed

- `kyro doctor`, `kyro install`, and `kyro sync` no longer crash on an incomplete `kyro.json`
  (missing `installedAdapters`); they report a clean diagnostic and `install`/`sync` self-repair the
  file while preserving existing scopes.
- Sprint archive narratives no longer render `Sprint N: undefined` — the title is carried through the
  model and rendered deterministically by the CLI.

[4.1.0]: https://github.com/SynapSync/kyro-ai/releases/tag/v4.1.0
[4.0.0]: https://github.com/SynapSync/kyro-ai/releases/tag/v4.0.0
