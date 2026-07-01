# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.3.0] - 2026-07-01

Documentation audit, bug fixes, and token optimization. Eliminates all artifact model drift and
removes stale forward-looking docs.

### Fixed

- **Critical:** `kyro analyze` error message no longer references the removed `kyro migrate` command.
- **High:** 10 documentation files rewritten to reflect the `sprint.json`-only model; eliminated all
  references to pre-4.0 artifacts (`state.json`, `index.json`, `ROADMAP.md`, `events.ndjson`, `phases/`).

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
