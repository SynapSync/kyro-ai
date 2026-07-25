# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Minion protocol in core docs** — L0/L1 behavior consolidated into `architecture.md`, `maker-checker.md`, `context-management.md`, `teams.md`, and `cli.md`; removed links to deleted standalone minion pages.

## [4.37.0] - 2026-07-25

### Added

- **L0 Orchestrator–Minion execution protocol** — opt-in minion delegation documented on `execute-task` and `review-task` modes: lean brief from `context-pack --task`, structured status JSON, write matrix (orchestrator + CLI own workflow state), single-agent fallback when subagents are unavailable. Overview in `docs/architecture.md`; manual eval checklist in `docs/evals.md`.
- **L1 minion opt-in** — personal `local.json` `execution.minionEnabled` flag (default off), `minionEnabled` on `context-pack`, `minions/implementer` and `minions/checker` role helpers, and conditional mode routing when enabled. Documented in `docs/teams.md` and `docs/cli.md`.

## [4.36.0] - 2026-07-24

### Added

- **Optional scope `author` on init** — `kyro plan` (init mode) captures `sprint.json.author` from git `user.name` and/or a schema-valid `user.email` when at least one is set (`source: "git"`, `capturedAt`; present fields only). Malformed git email is dropped (name-only still captured when present). Omits the field when nothing usable remains. **Never blocks init** — author is best-effort enrichment only. Not accepted from the lean plan file. Sprint mode preserves an existing author. Surfaced on `kyro scope inspect` and `kyro status full`.

## [4.35.0] - 2026-07-22

### Added

- **Layered multi-dev project state** — shared `.agents/kyro/project.json` (principles, team policy, scopes registry cache) + personal `.agents/kyro/local.json` (`activeScope`, installed adapters). Install/sync migrate legacy monolito `kyro.json`, write `.agents/kyro/.gitignore` for local-only files, and rehydrate on-disk scopes.
- **`docs/teams.md`** — multi-dev commit matrix, clone bootstrap, dual-read/migration, optional `team.minPackageVersion`.
- **Doctor layered health** — validates shared/local shapes, WARNs on leftover live monolito, optional non-blocking WARN when runtime is older than `team.minPackageVersion`.
- **Read-only bootstrap remedies** — `status` / `context-pack` / `doctor` never create project state files; they surface `install --init-workspace` when layers are missing.

### Changed

- **README, getting-started, cli, architecture, adapters** document layered state as the multi-dev default (supersedes gitignore-entire-`kyro.json` as the only team strategy).
- **Codex / AGENTS.md projected block** points at `project.json` + `local.json` instead of monolito-only `kyro.json`.
- **`close-sprint` project-scope CAS** writes shared `project.json` on layered workspaces (monolito `kyro.json` only while dual-reading a live monolito).

### Fixed

- **Sprint close no longer diverges on layered-only workspaces** that lack live `kyro.json` after install/migrate (`STATE_DIVERGED … kyro.json: missing`).
- **`listScopeNames` dual-reads layered project state** so scope listing works when only `project.json` + `local.json` exist.
- **`uninstall` clears `installedAdapters` on layered state** (`local.json` / `project.json`) instead of rewriting live monolito `kyro.json`.

## [4.34.0] - 2026-07-22

### Added

- **`kyro scenario add` / `kyro scenario link`** — tool-owned scenario graph mutations after a sprint is active (append `spec.scenarios`, attach `task.scenario_refs`) so agents do not hand-edit `sprint.json` for post-plan coverage refine.
- **`kyro adr add`** — tool-owned full v4 ADR append (`title`/`context`/`decision`/`consequence`/`alternative`, optional id/status/date).
- **`context-pack.cliRecipes[]`** — copy-paste CLI commands for the current `nextAction` using the canonical agent entrypoint (plus status/doctor preflight).
- **Projected skill stubs pin `metadata.runtimeVersion`** and print the durable **CLI** invocation line so agents discover the entrypoint without tribal knowledge.
- **`kyro doctor` skill/runtime version check** — WARN when projected `kyro-*` skill stubs lag or lack a pin vs `manifest.packageVersion`.

### Changed

- **`kyro analyze` scenario coverage is ledger-aware.** Scenarios linked on tasks in closed sprints (via ledger `checkpoint` / `snapshot` archives) no longer report MEDIUM "has no task coverage" on the next active sprint. Truly uncovered scenarios still MEDIUM.
- **`kyro doctor` CLI invocation PASS line** now labels the **canonical agent entrypoint** explicitly.
- **ADR shape validation** names missing fields and includes a full example object plus `kyro adr add` remedy.
- **`kyro status` human output** clarifies that `activeSprint.status: planned` with `nextAction: execute_task` is coherent (progress vs routing).

### Fixed

- **`check:lossless-checkpoints` heartbeat stall cases use a CI-safe 1s test lease** (was 300ms) and a longer readiness budget, so Worker renewals under loaded GitHub runners are not fail-stopped before the first post-ready tick.

## [4.33.2] - 2026-07-22

### Fixed

- **`kyroInvocation` is global-only (no more per-project drift).** Install/sync still probe PATH and persist the runnable form on `~/.agents/kyro/current/manifest.json`, and still substitute `{{KYRO_CLI}}` into projected modes under `current/`. Project `.agents/kyro/kyro.json` no longer stores `kyroInvocation`; any legacy copy is stripped on the next install/sync of that workspace (same pattern as the retired project-local `runtimeVersion`). Consumers use `getPersistedKyroInvocation()` (manifest first, then live resolve) and never read project state for the CLI string. One machine-wide install/sync is enough for all workspaces; you no longer need to re-sync every repo solely to fix a stale bare `"kyro"` left in each `kyro.json`. Multi-version runtime (retiring the `current` singleton) remains deferred and is out of scope for this change.
- **State-writer lock reclaim claims stay selectable under short test leases.** `publishReclaimClaim` now floors claim TTL at 2s (`MIN_RECLAIM_CLAIM_MS`) so CI/`check:lossless-checkpoints` reclaim races do not expire the claim before the winner can select it under sub-second lease windows.

## [4.33.1] - 2026-07-22

### Fixed

- **Install/sync no longer persists bare `kyro` from ephemeral npx PATH.** `npx kyro-ai install` temporarily puts `…/.npm/_npx/…/bin/kyro` on PATH; the probe treated that as durable and wrote `kyroInvocation: "kyro"` into `manifest.json` / `kyro.json` / projected modes. After npx exited, agents got `command not found` and fell back to hand-writing `sprint.json`. Ephemeral package-manager paths (`_npx`, yarn/pnpm dlx) are now rejected; install falls back to the stable `node ~/.agents/kyro/current/dist/cli.js` form. `kyro doctor` fails closed when a persisted bare `kyro` is missing or still resolves only to an ephemeral path. Re-run `npx kyro-ai sync` (or install) once to refresh workspaces that already have a stale `"kyro"` invocation.

## [4.33.0] - 2026-07-21

### Added

- **Install/sync rehydrates scopes from disk into `kyro.json`.** When workspace state is written, Kyro unions directories under `.agents/kyro/scopes/` into `scopes[]` (title/status from `sprint.json` when readable). Existing registry entries are never clobbered. If `activeScope` is null and exactly one scope is known, it is set automatically; with multiple scopes it stays null so each developer chooses with `kyro scope set-active`. This unblocks the multi-dev pattern where `kyro.json` is gitignored (personal `activeScope`) but `scopes/` is shared.
- Interactive `npx kyro-ai install` prompt now lists on-disk scopes when present, so answering **y** clearly registers them.
- `kyro doctor` WARNs when scope folders exist on disk but are missing from `kyro.json.scopes[]`, with a remedy to re-run install/sync.

## [4.32.0] - 2026-07-21

### Removed

- **`wrap_up` is gone.** Closing the last sprint now sets `handoff.nextAction: "done"` (with `status: "completed"`). `done` is a terminal handoff: empty routing modes, budget class `brief`, no close-mode load, no post-close action. Pre-existing artifacts that still say `wrap_up` are normalized to `done` on read/validation so customer scopes keep loading without a mass migration.

## [4.31.0] - 2026-07-20

### Fixed

- `kyro repair` now consumes the confirmation guard like every other mutating verb instead of prompting interactively. Previously, with no TTY and no `--yes`/`--confirm`, it printed `Normalize sprint.json? [y/N]`, read an empty answer, and **exited 0 having done nothing** — which a non-interactive agent reads as success. It now routes through `evaluateGuard('repair_scope', …)` and exits non-zero with `CONFIRMATION_REQUIRED` when unconfirmed, matching `kyro review` and `kyro scope set-active`; `kyro repair --yes` still normalizes. The interactive `[y/N]` helper was removed. Surfaced by a field-test review of a client's Codex sprint session.
- Read-only / permission durable-write failures now report an actionable `WRITE_NOT_PERMITTED` error with a remedy instead of an opaque message. A new `describeWriteFailure` helper (`src/cli/core/errors.ts`) classifies `EROFS`/`EACCES`/`ENOSPC` and is applied at every durable-write site: the operation pipeline (`review`, `repair`, and any tool-owned write) via `formatPipelineError`, and all three of `close-sprint`'s writers (`atomicReplace`, `publishExclusive`, and the `ensureDurableDirectory` mkdir, which are now inside the guarded try). Under Codex's default read-only sandbox the previous errors (`Apply failed and rollback completed: EROFS…`, `Durable file operation failed and temporary cleanup also failed`, raw `EACCES: … mkdir …`) gave the agent no remedy and cost repeated failed retries; the new message names the cause and tells sandboxed agents (Codex/OpenCode) to re-run with write access to `.agents/kyro`.

### Changed

- Clarified in the runtime instructions and architecture docs that `sprint-forge` is a **skill loaded as instruction files**, not a spawnable subagent — the only Kyro agent is `orchestrator`. A field-test agent driving planning outside `/kyro:forge` tried to invoke `kyro-ai:sprint-forge` through the Task/Agent tool (which fails, then self-recovers to `orchestrator`); the plan-sprint mode and `docs/architecture.md` now state that a sprint is materialized via `/kyro:forge` or the tool-owned `kyro plan --from` verb, never by spawning `sprint-forge` as an agent.

## [4.30.2] - 2026-07-19

### Fixed

- Documentation QA follow-up: corrected stale narrative that still described the agent hand-writing state, which a keyword-grep pass had missed because the phrasing ("record compact task evidence **directly on the task object** in `sprint.json`", "one safe write back to `sprint.json`") did not contain the searched terms. Updated `docs/getting-started.md`, `docs/architecture.md` (the `/kyro:forge` flow steps + the artifact-layout mutation note), `docs/cost-model.md` (Write Policy table), `docs/context-management.md`, `docs/programmatic-usage.md` (Artifact Contract), and `README.md` to describe the tool-owned verbs (`kyro plan`, `record-evidence`, `review`, `debt`, `add-emergent`, `close-sprint`) as the way state is written. No behavior change — documentation accuracy only.

## [4.30.1] - 2026-07-19

### Changed

- Documentation polish. Removed two dead, unreferenced docs that shipped to npm: `docs/agents-reference.md` (described a superseded verbose orchestrator model that contradicted the current lean `agents/orchestrator.md`) and `docs/cost-optimization-audit.md` (a point-in-time audit fully superseded by `docs/cost-model.md`). Extended the multi-agent guides — `docs/agent-adapters.md`, `docs/HOW-TO-USE-CODEX.md`, `docs/HOW-TO-USE-OPENCODE.md` — to document the tool-owned CLI verbs (`kyro plan`, `record-evidence`, `review`, `debt`, `add-emergent`) and to state the portability boundary explicitly: the deterministic gates live in the CLI and are identical on Codex and OpenCode; only the two `PreToolUse` hooks are Claude-only reinforcements. `docs/status-coherence.md` was reviewed and kept (still accurate).

## [4.30.0] - 2026-07-19

### Added

- `kyro add-emergent` — tool-owned append of an emergent task to `activeSprint.emergentTasks[]`, so the agent no longer hand-edits the full sprint file to record required work discovered mid-sprint. Takes `--title`, `--description`, one or more `--acceptance` (a task needs acceptance criteria), optional `--file`/`--context`/`--depends-on`. The new task gets a fresh sequential id (`E1`, `E2`, …), `status: pending`, `evidence: null`, `verdict: null`, so `kyro record-evidence` and `kyro review` then operate on it like any planned task. Requires an active sprint (`NO_ACTIVE_SPRINT` otherwise) and validates every `--depends-on` against existing task ids (`TASK_NOT_FOUND` otherwise); recomputes `activeSprint.status` and leaves the handoff untouched (an emergent task does not reroute the flow). With this, the residual hand-edit paths flagged by the field test are closed for debt and emergent tasks; clarification-answer application stays agent-driven by design.

## [4.29.0] - 2026-07-19

### Added

- `kyro debt <subcommand>` — tool-owned mutation of `sprint.json.debt[]`, so the agent no longer hand-edits the full sprint file to track technical debt. Five operations: `add` (appends `{ id: debt-<next>, origin, priority, status: open, ... }` with a never-reused sequential id and origin derived from the current sprint), `start` (open/deferred → in_progress; refuses to restart resolved debt), `resolve` (→ resolved, optional `--note`), `defer` (→ deferred; requires both `--target` and a non-empty `--note` — deferring without a concrete reason is the anti-pattern the debt discipline exists to prevent), and `escalate` (raises priority only; refuses to lower). Debt is never deleted — only its status/priority/target/note change. Each op validates the sprint, mutates only the target item, and re-verifies the written file. `kyro status debt` remains the read-only inspector, and its remedy now points at these commands instead of a hand-edit.

## [4.28.0] - 2026-07-19

### Added

- `kyro plan --from <file>` now has a **sprint mode** (increment 2 of the tool-owned planning path). The command auto-detects mode from scope state: no `sprint.json` → init/bootstrap (unchanged); an initialized scope with `activeSprint: null` and `handoff.nextAction: "plan_sprint"` → sprint mode, which materializes the next `activeSprint` from a compact lean sprint-plan file (`sprint`, `phases`/`tasks`, `definitionOfDone`, optional `scenarios`). It expands each task to `status: "pending"` / `evidence: null` / `verdict: null`, derives `activeSprint.status` (`"planned"` for an all-pending sprint — never hardcodes `"executing"`, which the hand-write path did and which tripped an analyze coherence finding), merges scenarios into `spec.scenarios` by id, flips the matching `roadmap.sprints[]` entry to `state: "active"`, wires `handoff` to `execute_task` (or `clarify` when `[NEEDS CLARIFICATION]` markers are present), and reconciles the `kyro.json` scope-status cache so the written artifact is fully coherent (zero stale-status findings). It refuses with `SPRINT_ALREADY_ACTIVE` when a sprint is already active and `NOT_READY_TO_PLAN` when the handoff is not `plan_sprint`. Validates `sprint.n` against the expected next number (ledger max + 1), unique task/phase ids, and `depends_on`/`scenario_refs` referential integrity.

## [4.27.0] - 2026-07-19

### Added

- `kyro plan --from <file>` — tool-owned scope bootstrap (init mode). The planning phase previously had no CLI write path: the agent hand-authored the whole fat `sprint.json` per the INIT contract (read→parse→mutate→write the monolith, ~63% of which is static spec/roadmap). `kyro plan` takes a compact lean plan JSON (`scope`, `title`, `objective`, `successCriteria`, `spec`, `roadmap`) and materializes the full validated v4 `sprint.json` (`activeSprint: null`) plus registers the scope in `kyro.json` — so the agent writes only the essential fields and never touches the full document by hand. It refuses with `SCOPE_ALREADY_INITIALIZED` rather than overwrite an initialized scope, allows `[NEEDS CLARIFICATION]` markers at planning (routing `handoff.nextAction` to `clarify`) without the execute-phase block, and is portable — any host driving the CLI gets a deterministic, schema-owned bootstrap. Per-sprint `activeSprint` materialization is a later increment; INIT mode's guidance now points at this command with the hand-write contract kept as fallback.

## [4.26.2] - 2026-07-19

### Fixed

- `kyro review` no longer rejects acceptance criteria over cosmetic differences. Coverage matching (`missingCheckedCriteria`, plus the waiver-exclusion in `review.ts`) previously compared `--checked-criterion`/`--waive-criterion` against stored `acceptance_criteria` byte-for-byte, so a one-character paraphrase — a stray space, a backtick, different case — marked the criterion uncovered and failed the review, looping the agent through opaque rejections. Matching is now normalization-insensitive via a shared `normalizeCriterion` (NFC, strip backticks, collapse whitespace, trim, lowercase); the written verdict still stores the agent's original strings. When a supplied criterion matches no acceptance criterion even after normalization, `kyro review` now fails fast with `INVALID_INPUT` listing the exact expected criteria to paste, instead of surfacing an indirect coverage finding.

## [4.26.1] - 2026-07-19

### Fixed

- Clarification gate no longer false-positives on prose that *documents* the marker syntax. The detector (`countClarificationMarkers`, shared by `kyro analyze`, `kyro doctor --artifacts`, `kyro record-evidence`, and `kyro review`) previously did a raw substring scan of the whole serialized `sprint.json`, so any spec/task text that merely *mentioned* `[NEEDS CLARIFICATION]` — e.g. when the project being built is itself a tool with such a gate — blocked execution. It now counts only unresolved markers: the closed colon form `[NEEDS CLARIFICATION: <concrete gap>]`, excluding backtick-wrapped references (the repo-wide documentation convention) and placeholder payloads (`<gap>`, `...`). Real markers still block on every host; the three duplicated inline scans (analyze, doctor, eval predicate) were unified onto the single detector.

## [4.26.0] - 2026-07-18

### Added

- Portable clarification gate: `kyro record-evidence` and `kyro review` now fail with `CLARIFICATION_REQUIRED` while `sprint.json` still contains unresolved `[NEEDS CLARIFICATION]` markers. The deterministic marker check already existed but only ran at the close gate; moving it into the two execute-phase CLI commands (which run on every agent host) blocks execution the moment it starts with unresolved unknowns, instead of surfacing them late at close. This is portable — no host-specific hook.

## [4.25.0] - 2026-07-18

### Added

- `kyro record-evidence <task>` writes `task.evidence` and sets `task.status` through the CLI, so the maker no longer hand-edits the 10–20k-token `sprint.json` to record a task (each hand-edit was a whole-file read + rewrite). It sets `status` (`done` by default, `--status blocked` after repeated failures), routes `handoff` to `review_task`, and never touches `task.verdict` (the checker still owns that via `kyro review`). Accepts repeatable `--validation`/`--file`, optional `--notes`, and `--by` (defaults to `maker`). The evidence it writes is validated end-to-end: `kyro review --verdict pass` accepts it without `--yes`.

### Changed

- The execute-task mode now records evidence via `kyro record-evidence` instead of a hand-edited safe-write. Hand safe-writes remain only for emergent tasks and debt.

## [4.24.0] - 2026-07-18

### Removed

- Deleted a pre-v4 legacy documentation subsystem that nothing in the current workflow loads or references: `contexts/` (old context-mode files), `rules/` (pre-v4 rule files, superseded by JSON `conventions[]`/`principles[]` and the runtime `.agents/kyro/scopes/rules.md`), `templates/split-claude-md/` (unused CLAUDE.md-splitting templates), `docs/rules-guide.md`, and the orphaned `skills/sprint-forge/assets/modes/analyze.md` mode doc (the `analyze` step is a CLI command, not a loaded mode). Removed the now-empty `rules`/`contexts`/`templates` entries from the npm `files[]` and the README link to the rules guide. No runtime behavior changes; the `wrap_up` routing and all live modes/helpers/protocols are unaffected.

## [4.23.0] - 2026-07-18

### Removed

- The `/kyro:wrap-up` command (projected skill `kyro-wrap-up`) is removed. Its only unique job was writing a resume note into `sprint.json.handoff`, which is already covered: `close-sprint` refreshes the handoff at every sprint boundary, `/kyro:task-context` regenerates a resume prompt from live state on demand, and `review`/`execute` keep `nextAction`/`nextTaskId` current. Dropping it removes a redundant command surface and the naming collision with the `wrap_up` routing state. Command count is now 5. **The `wrap_up` `nextAction` routing state is unchanged** — closing the last sprint of a scope still routes there.

## [4.22.0] - 2026-07-18

### Added

- `kyro close-sprint` now recommends starting the next sprint in a fresh session when sprints remain (`plan_sprint`), and prints paste-ready handoff facts (scope, `sprint.json` path, `nextAction`, note). Carrying one session across a multi-sprint run is the biggest token-cost amplifier; a fresh session reloads only the lean handoff. When no sprints remain (`wrap_up`) it points at `/kyro:wrap-up` instead. The close-sprint mode directs the agent to generate the continuation prompt for the user. Portable to every agent (deterministic CLI output — no host hooks).

## [4.21.0] - 2026-07-18

### Added

- PreToolUse Bash guard (`guard-bash-output.mjs`) blocks a recursive `rg`/`grep -r` search only when it has no output bound at all — no cap, no scope, no redirect — which is the single biggest measured token cost in real runs (an uncapped repo-wide search can pull tens of thousands of tokens into context in one call). Bounded/scoped searches, tests, and non-search commands pass untouched, and the guard fails open on anything ambiguous. Its block message hands back the bounded form to re-run.

### Changed

- Execute and review modes and the reviewer helper now direct validation to the touched area: tests scoped to the changed files instead of a full-suite re-run, and searches capped/scoped rather than repo-wide.

## [4.20.1] - 2026-07-16

### Fixed

- Release CI now rejects versions that already exist as a GitHub Release, Git tag, or npm package, so reused versions fail visibly during PR validation instead of producing a green run with skipped publish jobs.
- `kyro doctor` no longer fails npm-package packaging checks (`agents/orchestrator.md`, `.claude-plugin/`) when the CLI is invoked via the projected runtime (`node ~/.agents/kyro/current/dist/cli.js`). Those checks run only against the full package layout; projected-runtime roots report an explicit PASS and a light runtime shape check instead.
- Root classification is fail-closed across verified full-package, projected-runtime, and unknown/corrupt layouts. Multiple independent runtime markers (`manifest.json`, `KYRO.md`, `core/agents/`, `core/WORKFLOW.yaml`) keep partial runtimes mode-aware, while marker-less or conflicting roots skip package checks and report an explicit root failure.
- `install` and `sync` run only from a positively verified full npm package. Projected, partial, conflicting, and unknown roots return `INVALID_INPUT` with an actionable `npx kyro-ai` remedy instead of reaching a cryptic `ENOENT` on `agents/`.
- `doctor --tokens` from the projected runtime fails with a clear package-only message rather than packaging `ENOENT` noise.
- Doctor remedies for missing runtime files, adapters, or a broken CLI invocation point at `npx kyro-ai` (full package) rather than bare `kyro install`/`kyro sync`, which are blocked from the projected fallback.

### Changed

- Project state no longer stores a stale `runtimeVersion` snapshot. The active version is read from `~/.agents/kyro/current/manifest.json.packageVersion`; install and sync remove the legacy field while preserving project-owned state and metadata.
- INIT, projected command skill stubs, and CLI docs clarify the two CLI roots: full npm package for install/sync/token audit; projected runtime for agent workflow commands (`status`, `doctor --artifacts`, `analyze`, `repair`, `close-sprint`, …).

## [4.20.0] - 2026-07-15

### Added

- Scope-local JSON ADRs now live in `sprint.json.adrs[]`, giving each Kyro scope durable architectural decision records with status, context, decision, consequences, alternatives, and typed links.
- `kyro context-pack` includes ADR records, `kyro status full` reports ADR status counts and recent ADRs, and `kyro doctor --artifacts` validates malformed ADR records through the sprint schema.

### Changed

- New scope templates include `adrs: []`, while existing scopes remain compatible because the field is optional. Sprint-forge guidance now distinguishes operational `conventions[]` from durable architectural `adrs[]`.

## [4.19.0] - 2026-07-13

### Added

- Sprint close now dual-writes the compatible verbatim ActiveSprint snapshot and an immutable `SprintCloseCheckpointV1` containing complete scope state before and intended after close, affected project scope state, frozen close inputs, and canonical SHA-256 digests.
- Artifact doctor classifies checkpoint transactions as `PREPARED`, `PARTIAL`, `APPLIED`, `DIVERGED`, `CORRUPT`, or `UNSUPPORTED_VERSION`, including when live `sprint.json` is missing or invalid.

### Changed

- Sprint close uses a dedicated durable transaction with exclusive checkpoint publication, atomic mutable replacements, compare-and-swap reconciliation, idempotent resume, and scope-entry-only `kyro.json` patching.
- All official Kyro state writers share one serialization lock; checkpoint publication and mutable replacements fsync their parent directories, and managed checkpoint paths reject workspace escapes and symlinked ancestors.
- Checkpoint validation derives the authorized intended-after transition from the before image and frozen inputs. Doctor compares live state only with the latest transaction while validating older checkpoints as historical records.
- Recovery guidance now distinguishes versioned lossless scope checkpoints from legacy sprint-level snapshots; historical archives are never backfilled with invented state.

## [4.18.0] - 2026-07-12

### Changed

- Refactored `/kyro:idea` and the Seedbed skill into a plan-grade pre-scope flow with rough/mature lanes, evidence grounding, a material-question gate, and a Forge-compatible handoff. Documentation and adapter metadata were synced to describe the new behavior, and `check:seedbed` now covers the Seedbed contract fixtures.

## [4.17.1] - 2026-07-11

### Fixed

- `/kyro:qa` command is now properly registered in adapter fixtures (standard, OpenCode, Codex). The kyro-qa command skill was missing from the list of expected command skills projected for adapters, preventing it from being discovered in non-Claude environments.

## [4.17.0] - 2026-07-11

### Added

- `/kyro:qa` is now available as a dedicated slash command. It exposes the `qa-review` skill to run certification audits on any scope, independent of the forge cycle. The QA command validates code quality, architecture alignment, security, testing, reliability, performance, and planning artifact synchronization against the scope specification. Audit verdicts (APPROVED, APPROVED WITH NOTES, CHANGES REQUIRED, REJECTED) are review-level conclusions and do not get written into `sprint.json` task verdicts, which continue to use the binary `pass`/`fail` schema for the forge gate system. QA can be run anytime — during active sprints, after completion, or as a one-off validation check.

### Changed

- Command documentation now lists 6 slash commands (was 5, now includes `/kyro:qa`).
- `AGENTS.md` updated to report accurate counts: 6 commands, 3 skills (was understated as 4 commands, 2 skills).
- Marketplace description updated to mention independent QA certification.

### Fixed

- `/kyro:qa` command now includes all required declarative rules matching sibling command patterns (read-only rule, orchestrator-bypass rule, {{KYRO_CLI}} doctor --artifacts reference).
- QA verdict vocabulary clearly separated from `sprint.json` task verdict schema to prevent confusion.

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

- **`kyro close-sprint`** — deterministic sprint close. Writes the verbatim ActiveSprint JSON snapshot
  to `archive/` **before** clearing `activeSprint`, renders the human narrative `.md` (title sourced
  from `roadmap.sprints[]`, so it can never be `undefined`), appends the `ledger[]` entry, updates
  `previousSprint`/`roadmap`/`handoff`, and flips the `kyro.json` scope status on the last sprint.
  Refuses to run if a snapshot already exists (double-close protection). New `--learning` flag.
- **PreToolUse guard** (Claude Code) that blocks any hand edit nulling `activeSprint`, redirecting to
  `kyro close-sprint`.
- **`kyro doctor --artifacts`** now audits verbatim ActiveSprint snapshots, archive narratives (catches
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
