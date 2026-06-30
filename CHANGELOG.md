# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2026-06-30

Major release. Kyro moves to a single source of truth per scope — `sprint.json` — and makes the
irreversible operations (sprint close, narrative rendering) tool-owned and deterministic instead of
agent-rendered prose. This removes the entire v3 artifact stack.

### Breaking Changes

- **Single source of truth.** Each scope is now one `sprint.json` plus the global `kyro.json`
  registry. Agents read two files and route on `handoff.nextAction`.
- **v3 artifacts removed.** `state.json`, `index.json`, `ROADMAP.md`, `ROADMAP.summary.json`,
  `DEBT.summary.json`, `events.ndjson`, `rules.index.json`, `rules.md`, `RE-ENTRY-PROMPTS.md`,
  `phases/`, and all `*.summary.json` are gone. Run `kyro migrate --kyro-scope <scope>` to upgrade a
  v3 scope.
- `kyro.json.scopes[]` entries are objects `{ id, title, status }`, never bare strings.

### Added

- **`kyro close-sprint`** — deterministic, zero-loss sprint close. Writes the verbatim JSON snapshot
  to `archive/` **before** clearing `activeSprint`, renders the human narrative `.md` (title sourced
  from `roadmap.sprints[]`, so it can never be `undefined`), appends the `ledger[]` entry, updates
  `previousSprint`/`roadmap`/`handoff`, and flips the `kyro.json` scope status on the last sprint.
  Refuses to run if a snapshot already exists (double-close protection). New `--learning` flag.
- **`kyro migrate`** — upgrades a v3 scope to the v4 `sprint.json` model.
- **PreToolUse guard** (Claude Code) that blocks any hand edit nulling `activeSprint`, redirecting to
  `kyro close-sprint`.
- **`kyro doctor --artifacts`** now audits zero-loss snapshots, archive narratives (catches
  `Sprint N: undefined`), `activeSprint.title`, and non-object task `evidence`.
- Anti-v3 verification gate (`check:no-v3`) and v4 doctor fixtures (`check:sprint-doctor-v4`) wired
  into `npm run check`.

### Changed

- Runtime (orchestrator, commands, modes, helpers) and the CLI both speak only the v4 `sprint.json`
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

[4.0.0]: https://github.com/SynapSync/kyro-ai/releases/tag/v4.0.0
