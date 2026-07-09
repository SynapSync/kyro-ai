# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.16.2] - 2026-07-09

### Fixed

- `kyro review --verdict pass` no longer accepts a pass verdict on a task that is not
  `status: done`. Every checker finding was gated behind `status === 'done'`, so a pass
  written onto a still-pending task produced zero findings and the review gate never fired —
  leaving the sprint in an inconsistent state (pass verdict + pending status + a handoff stuck
  on the same task). A new CRITICAL checker finding now blocks that pass and also surfaces the
  inconsistency in `kyro analyze`. Combined with the existing done-without-evidence check, a
  pass verdict now requires the task to be executed (done with valid evidence) first.
- `kyro analyze` malformed-evidence findings now name the exact failing field (e.g.
  `evidence.notes must be a string when present`) instead of only the generic "missing or
  malformed evidence", reusing the schema validator so hand-fixing evidence no longer requires
  guessing the contract.

## [4.16.1] - 2026-07-08

### Added

- `/kyro:idea` is now projected to CLI hosts (opencode, codex) as the `kyro-idea`
  command skill. Idea maturation previously shipped only on the Claude plugin; the CLI
  installer's command set omitted it, so `kyro install --agent opencode/codex` never
  surfaced it. `idea` is now part of `COMMAND_NAMES` and installs alongside `kyro-forge`,
  `kyro-status`, `kyro-wrap-up`, and `kyro-task-context`.

### Notes

- Existing installs must re-run `kyro install` (or `kyro sync`) to project the new
  `kyro-idea` skill; `kyro doctor` flags it as missing until then.
- Naming stays consistent with the `forge`/`sprint-forge` pattern: the public command is
  `idea` (`kyro-idea`), backed by the internal `seedbed` skill — the skill name is never
  projected, exactly like `sprint-forge` sits behind `kyro-forge`.

## [4.16.0] - 2026-07-08

### Changed

- Idea maturation is now its own skill, `seedbed`, instead of a mode inside
  `sprint-forge`. `skills/sprint-forge/assets/modes/idea.md` and the `matured-idea`
  template moved to `skills/seedbed/assets/`. This keeps the pre-scope idea workflow
  fully decoupled from the sprint cycle: `seedbed` loads only when `/kyro:idea` is
  invoked and shares no state with `sprint-forge`.
- `check:command-modes` now validates command→asset references across all skills, not
  just `sprint-forge`.

### Notes

- No user-facing change: `/kyro:idea` behaves identically (same bounded conversation,
  same pre-scope guarantees, same output path). Only the internal skill location changed.

## [4.15.0] - 2026-07-08

### Added

- `/kyro:idea` — an optional, pre-scope command that matures a rough idea into a
  structured brief through a bounded, one-question-at-a-time conversation, then writes
  one markdown document to `.agents/kyro/{docType}/{date}-{slug}.md` (`docType` is
  `plan`, `analysis`, or `constitution`). The brief can seed a later `/kyro:forge` scope
  with a richer objective than a one-liner.
- New `idea` mode (`skills/sprint-forge/assets/modes/idea.md`) and `matured-idea`
  template documenting the maturation loop and document shape.
- `INIT` mode now optionally reads a referenced matured-idea document to enrich a new
  scope's `objective`, `successCriteria[]`, and `spec.requirements[]`.
- `check:command-modes` — a static guard that every mode file a command references
  actually exists, preventing command-to-mode drift.

### Notes

- Fully additive and backward-compatible: `/kyro:idea` never reads, resolves, or creates
  a scope, `kyro.json`, or `sprint.json`; it does not go through the orchestrator; and it
  is kept explicitly separate from `kyro.json.principles[]`. Existing flows are unchanged
  when no matured-idea document is used.

## [4.14.0] - 2026-07-08

### Added

- `kyro install --verbose` and `kyro sync --verbose` now print the full operation plan
  only when explicitly requested, keeping normal installs compact.
- `kyro install --init-workspace` and `kyro install --no-init-workspace` now make
  workspace initialization explicit when installing the global runtime.

### Changed

- `kyro install` no longer prints every projected path by default; it now shows the plan
  summary plus the completion footer (`Kyro has been installed.`, `Version`, `State`,
  `Runtime`).
- `kyro install` now always refreshes the global runtime but skips creating
  `.agents/kyro/**` in new workspaces unless initialization is explicitly requested.

### Fixed

- `kyro install` and `kyro sync` now preserve existing project state fields such as
  `principles` and future top-level metadata while refreshing runtime fields.

## [4.13.0] - 2026-07-08

### Changed

- Installer/runtime projection now keeps a single active runtime at `~/.agents/kyro/current/`.
  Reinstalling or syncing replaces that runtime and removes the retired
  `~/.agents/kyro/versions/` layout instead of retaining multiple bundled CLI copies.
- `kyro sync --prune` now focuses on obsolete adapter-owned entrypoint files; legacy
  versioned runtime directories are cleaned automatically by install/sync.

## [4.12.0] - 2026-07-07

**Bundled runtime CLI.** The Kyro CLI now ships inside the projected runtime, so workflow steps (`close-sprint`, `analyze`, …) run without a `kyro` binary on PATH. Agents installed via `npx kyro-ai install` previously received the markdown runtime but no executable and blocked at CLI-owned steps; the runtime is now self-contained.

**Action required once:** run `npx kyro-ai@4.12.0 install` (or `kyro sync` if you have a global install) to re-project the runtime with the bundled CLI. Existing scopes and artifacts are preserved.

### Added

- Projected `dist/` (plus root `package.json`/`config.json`) into `~/.agents/kyro/versions/{v}/`, mirroring the npm layout so PACKAGE_ROOT-relative assets resolve when the CLI runs from the runtime.
- `kyroInvocation` resolver: resolves to `kyro` when on PATH, else `node ~/.agents/kyro/current/dist/cli.js`; persisted to `manifest.json` and `kyro.json`.
- `{{KYRO_CLI}}` placeholder substituted into projected skill/agent markdown at install/sync time, so projected CLI references always resolve to a runnable invocation.
- `doctor` CLI-invocation self-check: runs `<invocation> --version` and reports an actionable remedy when the runtime CLI can't execute.
- End-to-end `check:cli-bundle` proving `close-sprint` completes via the projected CLI with no PATH binary.

### Fixed

- Codex MCP registration now emits the resolved runnable command instead of a bare `command = "kyro"`, so the MCP server starts when no `kyro` binary is on PATH.

## [4.11.1] - 2026-07-06

Completes the 4.11.0 status-coherence patch so derived status, review waivers, and status-report surfaces behave consistently across CLI and MCP.

### Fixed

- `analyze` now reports stale `activeSprint.status` as an advisory MEDIUM coherence finding.
- `repair` now normalizes `activeSprint.status` alongside `phase.status` and the `kyro.json` scope-status cache.
- `review` now recomputes `activeSprint.status` after verdict writes, preventing a fresh review from creating sprint-level status drift.
- MCP `review_task` now accepts `waived_criteria` entries in the same `"criterion::reason"` format as the CLI and stores structured waiver records.
- `/kyro:status` router documentation now includes review-debt reporting instead of leaving that behavior only in the full STATUS mode prompt.

## [4.11.0] - 2026-07-06

Status coherence: lifecycle status is derived from task state, review debt is surfaced before close, and accumulated review debt is recoverable one task at a time. Grounded in a real production run of 4.9.0.

### Added

- Derived-status core (`src/cli/core/status.ts`): `derivePhaseStatus`, `deriveActiveSprintStatus`, `deriveScopeStatus` compute lifecycle status from the authoritative leaf (`task.status`), plus `normalizeStoredPhaseStatus` for vocabulary synonyms.
- `analyze` reports status-coherence findings: a phase whose stored status contradicts its tasks (MEDIUM), and a stale `kyro.json` scope-status cache (MEDIUM). Advisory — they never block a user-invoked close.
- `context-pack` surfaces maker/checker debt on every pull: `reviewPending` (done tasks lacking a pass verdict) and `nextTaskReview` (the task's checker findings), so the agent sees the gap before the wall at close.
- `kyro review --waive-criterion "<criterion>::<reason>"`: a pass verdict may waive an acceptance criterion obsoleted by an approved scope change; the reason is required and archived. `TaskVerdict.waived_criteria` added.
- `PHASE_STATUS_VALUES` constant and `WaivedCriterion` type.

### Changed

- **Review recovery (fixes a latent maker/checker bug):** the review gate now blocks only on checker findings scoped to the task under review, not the global set. Accumulated review debt (several `done` tasks without verdicts) is now payable one task at a time; previously reviewing any task was blocked by every other unreviewed task. `analyze` keeps the global view.
- `review` recomputes the reviewed task's `phase.status` on write, so phase status stops being an orphan field.
- `kyro repair` parses leniently, normalizes each `phase.status` to its derived value, reconciles the `kyro.json` scope-status cache, then validates the result. It can now migrate status drift instead of only reformatting already-valid files.
- `TaskEvidence.validation` accepts a string **or** a string array (real runs record multiple validation lines); the close narrative renders both.

## [4.10.0] - 2026-07-05

Sharpens the Agent-Computer Interface (ACI): consistent errors, real verbosity, actionable tool summaries, and a wider MCP surface.

### Added

- `verbosity` (`concise` | `detailed`) end to end: CLI `--verbosity` and MCP `context_pack` param now trim long-form advisory prose in concise mode (default stays `detailed`).
- `review_task` and `trace_tail` MCP tools, giving agent hosts parity with the CLI `review` and `trace` commands.
- Actionable one-line summaries in every MCP tool result (`content[].text`), with the full payload preserved in `structuredContent`.
- CLI `--confirm` alias for `--yes`.
- Five new typed error codes (`UNKNOWN_COMMAND`, `UNKNOWN_SUBCOMMAND`, `UNKNOWN_TOOL`, `NO_ACTIVE_SPRINT`, `TASK_NOT_FOUND`) and `docs/aci.md`.

### Changed

- Every command/app-layer error now carries a typed `code` (and, where actionable, a `remedy`); plain `throw new Error` is gone from the command surface and gated by `check:mcp`.
- `check:mcp` now asserts the 9-tool golden catalog, usage guidance in every description, no dead schema params, and the no-plain-error contract.

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
