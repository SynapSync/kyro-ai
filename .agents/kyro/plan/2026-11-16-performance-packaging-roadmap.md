# Performance, validation and packaging roadmap

- **Created:** 2026-11-16
- **Baseline:** `develop` at `4c35f11`, kyro-ai 6.5.0
- **Work branch:** `develop` (phases 1 and 2 were committed there on 2026-11-16)
- **Status:** Phases 1 to 6 certified; Phase 7 structural part certified, its budget and README parts wait for a decision; Phase 8 pending

This document records a project review done on 2026-11-16 and the phased plan that came out of it.
It is the single place to track that plan. Any agent can resume from the "Status board" and the
"How to work a phase" sections without the original conversation.

## How to work a phase

1. The orchestrator delegates exactly one phase to an implementer (Sonnet 5.5). The implementer
   edits code and runs the phase's targeted checks. It does not commit and does not edit this file.
2. The orchestrator runs QA independently: it re-measures, compares CLI output against a pre-change
   baseline, reads the diff, and runs the checks itself. It does not trust the implementer's report.
3. If QA fails, the orchestrator returns concrete findings to the same implementer and repeats.
4. If QA passes, the orchestrator marks the phase `certified` in the status board, with the evidence.
5. The next phase starts only when the user says GO.

Project rules that apply to every phase:

- Run the targeted check scripts for the phase; run the full `npm run check` once, at integration.
- Temporary data goes under `~/.cache/kyro-tmp`, not the repo.
- No `Co-Authored-By: Claude` trailer on any commit. Commit only when the user asks.
- A version bump must also update `README.md` and `docs/cli.md` (`check:remediation-release-docs`).
- User-visible changes get an entry under `## [Unreleased]` in `CHANGELOG.md`.

## Status board

| # | Phase | Status | Certified | Evidence |
|---|-------|--------|-----------|----------|
| 1 | Memoize checkpoint reads and commitments | certified | 2026-11-16 | QA log, rounds 1 and 2; committed on `develop` |
| 2 | Fix checks under npm 12, widen CI Node matrix | certified | 2026-11-16 | QA log, phase 2 round 1; committed on `develop`; check the CI run |
| 3 | Slim the npm package and remove leftovers | certified | 2026-11-16 | QA log, phase 3 round 1; committed on `develop` |
| 4 | Parallel check runner and shared sandbox helper | certified | 2026-11-16 | QA log, phase 4 rounds 1 and 2; commit `bd02ed1` |
| 5 | Lazy command loading | certified | 2026-11-16 | QA log, phase 5 rounds 1 and 2; commit `17844ba` |
| 6 | Declarative flag parsing | certified | 2026-11-16 | QA log, phase 6 rounds 1 and 2; commit `66455ab` |
| 7 | Structure, budgets and README cleanup | partly certified | 2026-11-16 | File split certified (QA log, phase 7; commit `2912f41`). Token budgets and README release notes wait for the user's decision |
| 8 | Measure Kyro against other workflows; short path | pending | — | — |

Status values: `pending`, `in progress`, `in QA`, `returned`, `certified`.

## Findings (measured 2026-11-16, Node 26.12, npm 12.2.1, 16 cores)

### F-1 Every command re-reads and re-hashes the same checkpoints

There is no in-process cache, so cost grows with every closed sprint.

| Command | Time | File reads | Unique files | Bytes read |
|---|---|---|---|---|
| `kyro status` | 0.65 s | 447 | 147 | 18.5 MB |
| `kyro context-pack` | 0.49 s | 459 | 149 | 17.8 MB |
| `kyro doctor` | 0.72 s | 524 | 182 | 18.2 MB |
| `kyro doctor --artifacts` | 4.4 s | 4 258 | 251 | 192 MB |

- The repo holds 32 checkpoints, 1.8 MB in total. `doctor --artifacts` reads a single checkpoint
  up to 107 times; `status` up to 20 times. `lstat` calls: 2 997 for `status`, 35 525 for
  `doctor --artifacts`.
- CPU profile of `doctor --artifacts` (4.09 s sampled): `checkpointCommitmentOfRecord` 1.01 s,
  `sortJson` 0.72 s, `canonicalJson` 0.45 s, `lstat` 0.31 s, SHA-256 update 0.29 s,
  `readJsonSafely` 0.24 s.
- Code: `src/cli/checkpoints/sprint-close.ts` (`checkpointCommitmentOfRecord`,
  `checkpointIntegrityIssues`), `src/cli/core/digest.ts`, `src/cli/artifacts/json.ts`
  (`readJsonSafely`, fan-in 68), `src/cli/pipeline/state-writer-lock.ts` (`assertSafeManagedPath`).
- `status` and `context-pack` are what an agent calls every turn.

### F-2 `npm run check` takes 12.3 minutes and runs serially

- 87 steps chained with `&&`; total 740.6 s.
- Slowest: `check:cli-bundle-assets` 101 s, `check:machine-adapters` 78 s,
  `check:lossless-checkpoints` 57 s, `check:verification-states` 53 s,
  `check:close-policy-compatibility` 40 s, `check:scope-remediation` 34 s,
  `check:work-promotion` 31 s, `check:scope-retire` 27 s, `check:scope-debt-closure` 21 s,
  `check:active-plan` 18 s. The top 10 are 62 % of the time.
- There is no test framework. `scripts/` is 28 239 lines in 101 files against 35 886 lines in
  `src/`. 84 check scripts share nothing from `scripts/lib`; each builds its own sandbox and spawns
  the CLI many times.

### F-3 CLI startup loads every command

`kyro --version` takes 136 ms against 34 ms for bare Node. `src/cli/app.ts` imports all 30 command
modules at the top. The checks invoke the CLI hundreds of times, so this multiplies.

### F-4 Two checks break under npm 12

`scripts/check-cli-bundle.mjs:165` and `scripts/check-windows-install-smoke.mjs:41` do
`JSON.parse(pack.stdout)[0]`. npm 12 returns an object keyed by package name, not an array.
`check:cli-bundle` fails locally with `TypeError: Cannot read properties of undefined (reading
'version')`. CI pins Node 18/20/22, so it does not see this. It was the only failing step of 87.

### F-5 The npm package is 10 MB packed

22.1 MB unpacked, 1 074 files. `docs/diagrams` is 16 MB (44 PNG visual checks, 22 HTML files of
about 800 kB, 26 JSON) and no doc links to it. `scripts/` (1.8 MB) and `fixtures/` (1.1 MB) are
also published; parts of `src` read them (`commands/token-audit.ts`, `eval/discovery.ts`,
`core/capabilities.ts`, `artifacts/debt-contract.ts`, `commands/update.ts`), so what the runtime
needs has to be separated from what it does not.

### F-6 Leftovers

- `package.json` script `check:change-current-work:red` contains a personal absolute path
  (`/home/rperaza/Projects/projects-worktrees/kyro-ai-36c3897/dist/cli.js`) and is published.
- Both `package-lock.json` and `pnpm-lock.yaml` are tracked; CI and docs use npm only.
- `hooks/` and `providers/claude/commands/` are empty.

### F-7 Design debt

- Hand-written argument parsers are the most complex code: `parseOptions` has cognitive
  complexity 929, `printCommandHelp` 352, and about 15 per-command `parse*Args` functions follow
  (`parseRecordEvidenceArgs` 300, `parseCanonicalizeArgs` 191, `parseReviewArgs` 190).
- Large files: `remediation/plan.ts` 1 743 lines, `artifacts/schema.ts` 1 477, `types.ts` 1 307,
  `commands/plan.ts` 992, `remediation/protocol.ts` 988.
- Token budgets sit at the current size (for example 5 376 of 5 380 for `kyro-forge:plan`,
  5 580 of 5 620 for `init-seedbed`), so they constrain nothing and every prompt edit raises them.
- `README.md` carries release notes for 6.4.0, 6.4.1 and 6.5.0 that already live in the changelog.
- One call cycle: `doctor` → `runDoctorChecks` → `checkAdapterProjections` in `commands/doctor.ts`.

### F-8 What is in good shape

Strict input validation (unknown flags and commands fail with a coded error), 4 uses of `any` in
`src`, no TODO markers, writes under a fenced lock with fsync, no runtime dependencies.

### F-9 Environment notes (not code defects)

On the review machine `kyro doctor` fails "CLI invocation" and "CLI capabilities" because the
global `kyro` is installed for Node 22.20.0 and 26.10.0 while mise activates 26.13.1. It also warns
that `.kyro-state-writer.lock` is not ignored in this repo; `kyro sync` fixes that.

## Comparison with other tools

| | Kyro | OpenSpec | Spec Kit | BMAD | Beads |
|---|---|---|---|---|---|
| Unit of work | Scope → sprint → task | Change | Feature | Intent, many agents | Issue in a graph |
| Who writes state | CLI, with schema and lock | Agent, Markdown | Agent, Markdown | Agent | CLI (`bd`) |
| Separate evidence and review | Yes (maker/checker, independent QA) | No | No | Agent roles | No |
| Verifiable history | Hashed checkpoints | Manual archive | Git branch | No | Dolt database |
| Ceremony | High | Low | Medium | Very high | Minimal |

- Kyro goes furthest on integrity: none of the others has CLI-owned state, verifiable checkpoints
  or formal debt. That is also its largest cost; much of the code and of the 12-minute check suite
  exists to remediate and re-verify history.
- Uvik benchmark, 50 brownfield Python tickets, one model, last updated 2026-11-02:

  | Arm | Merge rate | Cost per merged ticket | Median time | Spec overhead | Review defects |
  |---|---|---|---|---|---|
  | Spec Kit | 80 % | $3.33 | 44 min | 18 min | 0.57 |
  | Kiro | 82 % | $2.35 | 41 min | 16 min | 0.39 |
  | BMAD | 82 % | $4.23 | 55 min | 28 min | 0.49 |
  | OpenSpec | 84 % | $2.71 | 36 min | 12 min | 0.40 |
  | No spec | 72 % | $2.43 | 29 min | 0 | 0.86 |

  Specs paid off on features and data pipelines (best spec arm 90 % against 60 %). On bug fixes,
  refactors and test writing the control matched or was cheaper. One team, one model, Python only:
  a signal, not proof.
- Kyro appears in no public measurement. An A/B bench already exists under
  `~/.cache/kyro-tmp/agility`.
- Beads covers cross-session memory with a four-command loop (`ready`, `show`, `claim`, `close`).
  It is the reference for shortening Kyro's common path.

Sources: <https://uvik.net/blog/spec-driven-development-benchmark/>,
<https://dabase.com/blog/2026/sdd-framework-comparison/>,
<https://www.thoughtworks.com/en-gb/radar/tools/openspec>,
<https://dev.to/willtorber/spec-kit-vs-bmad-vs-openspec-choosing-an-sdd-framework-in-2026-d3j>,
<https://codemyspec.com/blog/openspec-vs-spec-kit>,
<https://steve-yegge.medium.com/introducing-beads-a-coding-agent-memory-system-637d7d92514a>.

## Phases

### Phase 1 — Memoize checkpoint reads and commitments (F-1)

**Goal:** a single CLI process reads and hashes each managed file once while the file is unchanged.

**Scope:** `src/cli/artifacts/json.ts`, `src/cli/core/digest.ts`,
`src/cli/checkpoints/sprint-close.ts`, and callers only where needed. A new regression check.

**Constraints:**

- Output must not change. Every read-only command prints byte-identical output before and after.
- No stale reads. A file changed by this process or by another process must be re-read. The MCP
  server (`kyro mcp`) is long-lived, so the cache must be validated against the file on each use.
- A caller must never receive an object another caller can mutate in a way that changes results.
- Memory only. No cache on disk. No new dependency.
- The commitment encoding stays byte-compatible; historical checkpoints must still verify.

**Acceptance:**

- `kyro status` and `kyro context-pack`: file reads at most 1.5 × unique files (today about 3 ×).
- `kyro doctor --artifacts`: file reads at most 2 × unique files (today 17 ×) and wall time
  reduced by at least 60 % on this repo (today 4.4 s).
- Read-only output identical to the pre-change baseline for all 13 scopes.
- `npm run typecheck` and `npm run build` pass.
- Targeted checks pass: `check:lossless-checkpoints`, `check:status`, `check:verification-states`,
  `check:scope-remediation`, `check:repair-integrity`, `check:canonicalization-gate`,
  `check:replay-witness`, `check:lifecycle-replay`, `check:mcp`, `check:sprint-close-commit`,
  `check:layered-state`, `check:active-plan`.
- A new check guards the read counts and the no-stale-read behaviour, and is part of `npm run check`.

### Phase 2 — Fix checks under npm 12, widen CI Node matrix (F-4)

Accept both `npm pack --json` shapes in `check-cli-bundle.mjs` and
`check-windows-install-smoke.mjs`. Add a current Node release to the CI matrix so the next npm
change is caught. **Acceptance:** `check:cli-bundle` passes on npm 10 and npm 12; CI is green.

### Phase 3 — Slim the npm package and remove leftovers (F-5, F-6)

Keep `docs/diagrams` out of the tarball, or move it out of `docs/`. Publish only the scripts and
fixtures the runtime reads. Remove the personal path from `package.json`, the unused
`pnpm-lock.yaml`, and the empty `hooks/` and `providers/` directories. **Acceptance:** packed size
under 2 MB; `check:cli-bundle-assets`, `check:cli-bundle`, `check:eval` and `doctor --tokens` pass
from an installed tarball; no absolute home path in any published file.

### Phase 4 — Parallel check runner and shared sandbox helper (F-2)

A runner that executes the check scripts concurrently and reports per-step time and failures; a
shared sandbox and CLI-spawn helper in `scripts/lib`. Evaluate `node:test` for filtering.
**Acceptance:** full suite under 4 minutes on 16 cores with the same pass/fail results as the
serial run; `npm run check` keeps working as the single entry point.

### Phase 5 — Lazy command loading (F-3)

Load each command module only when its verb runs. **Acceptance:** `kyro --version` under 60 ms;
`check:cli-verbs`, `check:cli-envelope`, `check:capabilities` pass.

### Phase 6 — Declarative flag parsing (F-7)

One table of flags per command that drives parsing and `--help`. Migrate command by command.
**Acceptance:** identical behaviour and error codes for every existing flag (covered by
`check:cli-verbs` and `check:cli-envelope`); no parser function above cognitive complexity 50.

### Phase 7 — Structure, budgets and README cleanup (F-7)

Split the largest files along existing seams, give the token budgets real headroom rules, move
release notes out of the README, break the `doctor` call cycle. **Acceptance:** no source file above
1 000 lines; budgets documented with a stated margin; README free of per-version notes.

### Phase 8 — Measure Kyro against other workflows; short path

Run the existing A/B bench with Kyro Forge, Kyro Work, OpenSpec and no workflow on the same
tickets; record merge rate, tokens and time. Use the result to decide whether small fixes need a
shorter path. **Acceptance:** a results document under `.agents/kyro/analysis/` and a decision.

## QA log

Entries are added by the orchestrator, one per QA round.

### Phase 1, round 1 — 2026-11-16 — returned

Implementer: Sonnet 5.5. Design: `src/cli/artifacts/read-cache.ts` memoises file text and the
SHA-256 of the raw bytes, validated on every use by one `stat` (dev, inode, size, nanosecond mtime
and ctime) and stored only when the file is older than a 2 s racy window; callers parse their own
copy. Two verdict memos in `checkpoints/sprint-close.ts` key integrity issues and the commitment by
the content hash.

Verified by the orchestrator:

| Command | Reads / unique before | Reads / unique after | Time before | Time after |
|---|---|---|---|---|
| `status` | 447 / 147 | 149 / 147 | 0.65 s | 0.26 s |
| `context-pack` | 459 / 149 | 151 / 149 | 0.49 s | 0.25 s |
| `doctor` | 524 / 182 | 209 / 182 | 0.72 s | not re-timed |
| `doctor --artifacts` | 4 258 / 251 | 338 / 251 | 4.4 s | 1.0 s |

- Output byte-identical to the baseline: 33 captures over 13 scopes.
- Old build against new build over 14 tampered sandboxes, six commands each, cold and warm cache:
  identical stdout and exit codes.
- One long-lived process: same-size in-place tamper with mtime restored is detected; tamper by
  rename is detected; restoring the bytes restores the verdict; caller mutation does not leak.
- `lstat` counts are unchanged (path-safety checks were deliberately left alone).

Returned for:

1. `check:read-memoization` uses a single-checkpoint fixture; the defect scales with ledger length.
2. The verdict memos have no regression guard.
3. An orphaned JSDoc comment in `sprint-close.ts`.

### Phase 1, round 2 — 2026-11-16 — certified

The implementer fixed the three findings. Verified by the orchestrator:

- `check:read-memoization` now builds a scope with 4 closed sprints through the CLI and requires
  that no checkpoint is read more than twice by `status`, `context-pack` and `doctor --artifacts`.
  Against the pre-change build it fails with "a checkpoint was read 19 times (limit 2)".
- The verdict-memo probe was mutation-tested: with the integrity memo keyed by path instead of
  content hash, the check fails with "same-size tamper with restored mtime still valid".
- The JSDoc sits on `checkpointIntegrityIssues` again.
- `npm run build`, `npm run typecheck`, `check:dist` and the 12 targeted checks pass.
- Output is still byte-identical to the baseline; the long-lived process test still passes.
- Full suite, run step by step: 88 steps, 712 s, 87 pass. The one failure is `check:cli-bundle`
  with the npm 12 `TypeError` recorded in F-4, which fails the same way before this change and is
  Phase 2.

Residual notes, not blocking:

- `lstat` volume is unchanged (35 525 calls for `doctor --artifacts`); about 1 s remains there and
  in per-call parsing. A candidate for a later phase, with care for the path-safety checks.
- The racy window is 2 s. A filesystem with 2 s timestamp granularity (FAT) sits at that edge.
- The new check adds about 15 s to the suite.
- Committed on `develop` on 2026-11-16.

### Phase 2, round 1 — 2026-11-16 — certified

Implementer: Sonnet 5.5. Changes: `scripts/lib/npm-pack-json.mjs` (new helper that accepts the
npm 10 array and the npm 12 keyed object) used by `check-cli-bundle.mjs` and
`check-windows-install-smoke.mjs`; `.github/workflows/ci.yml` gains Node 26.x in the Windows matrix
and a Linux `npm_current` job on Node 26.x that gates `create_tag`.

Found beyond F-4, a product defect: under npm 12 `npm view kyro-ai version --json` prints
`["6.5.0"]` instead of `"6.5.0"`, so `queryRegistryLatest` in `src/cli/commands/update.ts` returned
null and `kyro update` reported the registry as unreachable. Fixed, with a new case in
`check-update.mjs`.

Verified by the orchestrator:

- npm 12.2.1: `check:cli-bundle` (failing before), `check:update`, `check:invocation`,
  `check:install-rehydrate`, `check:links`, build, typecheck and `check:dist` pass.
- Real npm 10.9.10 first on PATH: `check-cli-bundle.mjs` and `check-update.mjs` pass end to end.
- Both `npm view` output shapes confirmed against the real registry. With npm 12 shaped output the
  pre-change build returns null and the new build returns the version.
- The workflow parses; `create_tag` needs `validate`, `windows_state_writer_lock`, `npm_current`.
- Full suite, step by step: 88 steps, 697 s, 0 failures. First fully green run on this machine.

Not verifiable locally:

- GitHub Actions has not run the new workflow; the first push will show it.
- `check-windows-install-smoke.mjs` runs on Windows only and was reviewed by reading.

### Phase 3, round 1 — 2026-11-16 — certified

Implementer: Sonnet 5.5 (a new agent). `package.json` `files` now ships `dist` without source
maps, `commands`, `agents`, `internal`, `fixtures/evals`, `docs/*.md`, `docs/architecture.mmd` and
the one linked ADR, plus the root files. `docs/diagrams`, `scripts/`, the other fixtures and the
development plans stay in the repository only. `check:change-current-work:red` reads the baseline
from `KYRO_BASELINE_CLI` or `--baseline-cli`. `pnpm-lock.yaml` and the empty `hooks/` and
`providers/` directories are gone. New guard: `check:package-contents`.

| | Before | After |
|---|---|---|
| Packed | 9.98 MB | 0.68 MB |
| Unpacked | 22.2 MB | 2.67 MB |
| Files | 1 080 | 475 |

Verified by the orchestrator:

- Old and new tarballs installed into isolated prefixes and homes, 13 commands each: identical
  exit codes; outputs differ only in the runtime file count (614 against 346, the dropped maps).
- Projected skills are byte-identical; the runtime differs only in the maps, `manifest.json` and
  `package.json`.
- `kyro eval` from the new package: 31 of 31.
- The guard was mutation-tested: with the old `files` list it fails naming size, diagrams, scripts
  and fixtures; with a `/home/...` path added to a shipped doc it fails naming file and line.
- Typecheck and 12 targeted checks pass. Full suite: 89 steps, 704 s, 0 failures.
- Orchestrator edit: removed a changelog bullet about the empty directories, which were never
  tracked or published.

Not part of `npm run check`, and failing on this machine for environment reasons: `check:tokens`
(the global `kyro` is not installed for the active Node) and `check:change-current-work` (the local
Codex setup; the implementer reports the same failure on the previous code, not re-run by the
orchestrator).

### Phase 4, round 1 — 2026-11-16 — returned

Implementer: Sonnet 5.5 (a new agent). `npm run check` is now `node scripts/run-checks.mjs`; the
89 steps live in `scripts/lib/check-steps.mjs` in the original order; `check:serial` keeps the old
behaviour. `typecheck` and `check:dist` gate the rest; the pool runs 8 steps at a time on this
machine (`min(8, max(2, cores - 1))`); `check:canonicalization-gate` (rewrites files in `dist/`)
and `check:eval` (creates cases in `fixtures/evals`) run alone at the end. `check:capabilities`
and `check:operation-snapshots` were fixed to stop taking the state lock in the repo root. The
runner refuses to start when a `check:*` script is neither a step nor declared in `NOT_IN_SUITE`.

Verified by the orchestrator: the step list equals the old chain; parallel runs of 172.7 s and
169.9 s and a `--jobs 4` run of 229.0 s, all 89 of 89, against 704 s serial; the working tree and
every file under `dist/` byte-identical after the three runs; an injected failing step is reported
with name, exit status and full output, exit 1.

Returned for:

1. An interrupted run kept going for 70 s and then reported 3 passed, exit 0.
2. The runner injected `CI=''` into every step.
3. An inaccurate reason for `check:change-current-work` in `NOT_IN_SUITE`.

### Phase 4, round 2 — 2026-11-16 — certified

Verified by the orchestrator:

- SIGINT and SIGTERM after 6 s: exit 130 and 143 within about 30 ms of the signal, summary
  "INTERRUPTED", 3 steps listed as killed, none counted as passed, no child process and no
  `kyro-checks-*` temp directory left.
- A step no longer sees `CI` when it is unset.
- Full run after the fixes: 89 of 89, 177.5 s. The limiting step is `check:cli-bundle-assets`
  (about 150 s in the pool, 101 s alone).

Residual notes, not blocking:

- Interrupting during `check:dist` can leave a `.kyro-dist-check-*` directory in the repo root.
- Interrupting during `check:canonicalization-gate` could leave `dist/` modified; `npm run build`
  restores it.
- A 4-core CI runner was simulated only (`--jobs 4`, 229 s; pinned to 4 cores, 331 s by the
  implementer). The real CI time will show on the next pull request.
- The scripts were not mass-migrated to `scripts/lib/sandbox.mjs`; only the two fixed ones use it.

### Phase 5, round 1 — 2026-11-16 — returned

The implementation passed: 180 invocations (every verb with `--help`, `--help --json`, a bad flag,
and no-argument runs in this repository and in empty directories) gave the same stdout, stderr and
exit code as a build of the previous commit, apart from durations and trace timestamps.

Returned for the guard only. `check:cli-lazy-load` looked at `dist/cli/commands/*` alone, so two of
three injected regressions passed it: `help.ts` importing `./fs` again (`--version` back to 71 ms)
and a static import of the state-writer lock in `app.ts` (52 ms).

### Phase 5, round 2 — 2026-11-16 — certified

Verified by the orchestrator:

- The guard now fails on all three mutations (static command import, `./fs` in `help.ts`, static
  lock import). It asserts the exact `dist/` module set for `--version`, `-v`, `version` (7 modules,
  no `node_modules`) and for `capabilities --json` (those 7 plus its command), and for `--help` no
  command module and at most 50 `dist/` modules (40 today).
- Medians of 31 runs, previous commit against this one: `--version` 89.6 to 33.7 ms (bare Node
  27.7 ms); `capabilities --json` 90.7 to 33.1; `--help` 91.3 to 54.4; unknown verb 88.6 to 54.7;
  `plan --help` 126.6 to 92.4; `status` 253.8 to 225.0; `context-pack --json` 251.0 to 222.2.
  Modules loaded for `--version`: 130 to 7.
- Full `npm run check`: 90 of 90, 182.3 s.

Residual notes, not blocking:

- `--help` stays at about 54 ms because it loads the adapter registry to list agents.
- `kyro eval` spawns the CLI per scenario and dropped from about 8.5 s to about 4.9 s in one
  observation; not measured as a median.

### Phase 6, round 1 — 2026-11-16 — returned

The refactor passed. The orchestrator's own old-versus-new CLI fuzz (5,940 invocations over 27 verbs,
in empty and populated workspaces, comparing exit code, stdout, stderr and the resulting file tree)
found no behaviour difference. The differences it reported were timestamps in trace files, four more
runtime files copied by `adapters enable` (the new module), and one lock-heartbeat flake (below).

Returned for `check:flag-parsing` only: of six injected regressions, one passed it. Changing
`takeUnlessDashed` to reject any value starting with `-` changed `kyro rule add --rule -h`, and no
recorded case had a value flag followed by a single-dash token.

### Phase 6, round 2 — 2026-11-16 — certified

Verified by the orchestrator:

- The fixture grew from 1,410 to 2,226 cases (`-h`, `-y`, `-x`, `-`, `--` and `a=b` after every
  value flag), captured from the previous build. The missed mutation now fails the check.
- Cognitive complexity, measured with `eslint-plugin-sonarjs` (`~/.cache/kyro-tmp/phase6/cx/run.sh`):
  `parseOptions` 66 to 2, `printCommandHelp` 28 to 2, every other migrated parser 6 or lower, the
  shared `parseFlags` 19. No flag parser is above 50.
- Full `npm run check`: 91 of 91, 140.8 s.

Notes:

- Finding F-7 quoted 929 and 352 for `parseOptions` and `printCommandHelp`. Those came from a
  different metric (the code-graph index). Under the sonarjs rule they were 66 and 28.
- Help text is not generated from the tables: the usage grammar cannot be derived from them, so the
  text is kept byte for byte and pinned by hash.
- `parseCapabilitiesArgs` (complexity 4) was left as is to keep the `capabilities` startup path at
  its pinned module set.
- Observed once under heavy parallel load, on unchanged code: `State-writer lease heartbeat failed
  to start.` instead of the expected input error. 25 reruns on each build did not reproduce it.
  Worth a look if it shows up in CI.
- The highest complexities left in `src/cli` are outside flag parsing: `repair/integrity-plan.ts`
  138, `core/active-plan.ts` 125, `remediation/plan.ts` 101. They belong to phase 7.

### Phase 7, structural part — 2026-11-16 — certified in one round

Scope given to the implementer: the file split and the `doctor` cycle only.

Verified by the orchestrator:

- No file under `src/` is above 1,000 lines (largest: `remediation/protocol.ts`, 988).
  `remediation/plan.ts` 1,743 to 322, `artifacts/schema.ts` 1,477 to 352, `types.ts` 1,307 to 26,
  with 7, 5 and 9 new sibling modules.
- Runtime export names of all 136 modules of the previous build are identical. The non-import lines
  of each split file are the same multiset before and after (1,604, 1,354 and 1,170 lines).
- `check:canonicalization-gate` had to follow the moved code (three file paths and one anchor
  string). Old gate on the old build and new gate on the new build both report 120 assertions and
  8 guards proven load-bearing.
- CLI fuzz against the previous build, 2,295 invocations: no behaviour difference.
- Full `npm run check`: 91 of 91, 150.0 s. `kyro --version` still loads 7 modules (33.7 ms).

Notes:

- The `doctor` call cycle in finding F-7 does not exist: `checkAdapterProjections` never calls back
  into `doctor` or `runDoctorChecks`, and `doctor.ts` is in no module cycle. Nothing was changed.
  Two module cycles do exist elsewhere and predate this work: one of 15 modules across adapters,
  state, fs and checkpoints, and `remediation/plan` with `certification-plan`.
- `kyro --help` now loads 46 `dist/` modules, up from 40, against the ceiling of 50.
- `kyro status` measured 226 ms before and 233 ms after (medians of 25); within run-to-run noise but
  consistent with six more small modules to load.
- The comment above the `debt-contract` re-export in `types.ts` still says the module is free of
  imports; it now re-exports from `types/*`.

Not done, waiting for the user's decision because both change a stated policy:

- Token budgets: the check says that raising a ceiling is a deliberate policy change.
- README per-version notes: `check:remediation-release-docs` requires release text in the README.

QA tooling lives in `~/.cache/kyro-tmp/roadmap-qa/` (`baseline/`, `capture.sh`, `count.js`,
`differential.sh`, `longlived.js`, and `base/`, a build of the pre-change commit).
