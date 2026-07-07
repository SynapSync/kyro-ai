# Tasks: bundle-cli-into-runtime

Spec: `openspec/changes/bundle-cli-into-runtime/specs/runtime-cli-bundling/spec.md`
Design: `openspec/changes/bundle-cli-into-runtime/design.md`

Legend: `[P]` = safe to run in parallel with sibling `[P]` tasks in the same phase. Unmarked tasks are sequential (depend on the prior phase landing first). Each phase is one work unit (work-unit-commits): tests/checks land in the same commit as the behavior they verify.

---

## Phase 0 — Audit + characterization snapshot (safest first slice, no behavior change)

- [x] **0.1** Read-tool audit: confirm the 14-file / 33-occurrence CLI-reference inventory in design §5.2 is still accurate (files may have drifted since design was written). Record any deltas.
  - Satisfies: prerequisite for Requirement "All projected CLI references SHALL resolve to a runnable invocation"
  - Done: file count (14) confirmed; occurrence count drifted to 35 (analyze.md, clarify.md each +1). See `audit-phase0.md`.
- [x] **0.2** Read-tool audit: confirm the PACKAGE_ROOT reader table (design §3.2/§3.3) against current `src/cli/routing.ts`, `budget-manifest.ts`, `help.ts`, `constants.ts`.
  - Satisfies: prerequisite for Requirement "PACKAGE_ROOT-relative assets SHALL resolve correctly when CLI is bundled"
  - Done: table confirmed accurate; noted `budget-manifest.ts` lives at `src/cli/budget-manifest.ts`, not `src/cli/core/budget-manifest.ts` as design states (cosmetic doc drift only). See `audit-phase0.md`.
- [x] **0.3** Run current `npm run check` and `npm run typecheck` on `develop` to capture a clean baseline (characterization snapshot) before any change lands.
  - Satisfies: regression baseline for all requirements
  - Done: both green on branch before Phase 1 edits.

**Work unit:** docs/notes only (no `src/` diff) — commit as `chore(bundle-cli): audit CLI-reference and PACKAGE_ROOT surface before bundling`.

---

## Phase 1 — Mirror PACKAGE_ROOT assets (dist/ + package.json + config.json parity)

- [x] **1.1** Extend `src/cli/install-plan.ts` `buildInstallPlan` to add `dist/` (directory copy, verbatim), root `package.json` (verbatim), and root `config.json` (verbatim) projection alongside existing `core/config.json` / `core/WORKFLOW.yaml` copies (do not remove those).
  - Satisfies: Requirement "Projected runtime SHALL bundle a runnable CLI"; Requirement "PACKAGE_ROOT-relative assets SHALL resolve correctly when CLI is bundled"
- [x] **1.2** Extend `buildManagedFiles` to register every projected `dist/**` file plus root `package.json` and `config.json`.
  - Satisfies: Requirement "Projected runtime SHALL bundle a runnable CLI" (Scenario: "Projected dist/ is tracked and removed on uninstall")
- [x] **1.3** Add/extend a `check:*` script (or extend an existing install smoke check) asserting `{runtimeRoot}/dist/cli.js`, `{runtimeRoot}/package.json`, `{runtimeRoot}/config.json` exist after install into a temp HOME, and that each appears in `manifest.json.managedFiles`.
  - Satisfies: Requirement "Projected runtime SHALL bundle a runnable CLI" (both scenarios)
  - Done: `scripts/check-cli-bundle-assets.mjs` added and wired into `npm run check` as `check:cli-bundle-assets`.

**Work unit:** one commit — `feat(install-plan): project dist/ and package.json/config.json parity into runtime` (code + managedFiles + verification together).

---

## Phase 2 — Invocation resolver + manifest/kyro.json persistence

- [x] **2.1** Create `src/cli/invocation.ts`: `KYRO_CLI_PLACEHOLDER` const, `KyroInvocation` interface, pure `buildInvocation(kyroOnPath, kyroRoot)`, infra-isolated `isKyroOnPath()` (POSIX `command -v` / win32 `where`, swallow errors), and `resolveKyroInvocation()`.
  - Satisfies: Requirement "All projected CLI references SHALL resolve to a runnable invocation"
- [x] **2.2** Extend `src/cli/types.ts`: `KyroManifest.kyroInvocation: string` (schemaVersion stays 1, additive) and `KyroProjectState.kyroInvocation?: string`.
  - Satisfies: same requirement — persistence contract
- [x] **2.3** Wire `resolveKyroInvocation()` into `buildInstallPlan` (called once) and `mergeProjectState`, so `manifest.json.kyroInvocation` and `kyro.json.kyroInvocation` are set/refreshed on every install and sync (including upgrades of pre-existing installs).
  - Satisfies: Requirement "All projected CLI references SHALL resolve to a runnable invocation" (both resolution scenarios)
  - Done: `resolveKyroInvocation()` probed once in `buildInstallPlan`, threaded into `mergeProjectState` and the manifest object; `scripts/check-cli-bundle-assets.mjs` extended to assert both persisted fields match and shape-check (`kyro` or `node .../dist/cli.js`).

**Work unit:** one commit — `feat(cli): add kyroInvocation resolver and persist to manifest/kyro.json`. Include a small script or `check:*` snippet asserting the persisted field is present and matches PATH-present vs PATH-absent expectations (design §10.2 step 4 can be stubbed here and completed in Phase 7).

**Dependency:** requires Phase 1 (root `dist/`/`package.json` must exist for the fallback invocation `node {current}/dist/cli.js --version` to later be runnable in Phase 5/7, but this phase itself only needs the resolver + persistence, so it can start once Phase 1's shape is agreed — not its full landing).

---

## Phase 3 — `{{KYRO_CLI}}` placeholder: source edits, copy-step substitution, leak guard

Split into three sequential sub-slices because this phase is the largest (14 files, plus new plumbing, plus a new check):

- [x] **3.1** Extend `OperationPlan` (`src/cli/types.ts`) with optional `substitutions?: Record<string, string>`; extend `addCopyDirectoryPlan`/`addCopyFilePlan` (`src/cli/fs.ts`) with an optional `substitutions` param, threaded from `buildInstallPlan` for `skills/` (and any adapter markdown copy) only — `dist/`, `package.json`, `config.json`, `WORKFLOW.yaml` stay verbatim.
  - Satisfies: Requirement "All projected CLI references SHALL resolve to a runnable invocation"
  - Done: `agents/` (→ `core/agents`) also carries substitutions (orchestrator.md has 1 occurrence); `commands/` stays verbatim.
- [x] **3.2** Implement the copy-step substitution branch in `src/cli/pipeline/operation-steps.ts`: when `operation.substitutions` is present, read → `String.prototype.split(token).join(value)` for each entry → write; otherwise copy verbatim as today.
  - Satisfies: same requirement
- [x] **3.3** Re-enumerate (Read-tool, not grep — RTK mangles `.replace(` output) each of the 14 files from design §5.2 and convert literal `kyro <subcommand>` → `{{KYRO_CLI}} <subcommand>` (35 occurrences per audit-phase0.md, not 33 — analyze.md and clarify.md each had one extra inline occurrence). Do NOT touch `commands/{forge,status,wrap-up}.md` (those reference slash commands, not the CLI binary). `[P]` — each file edit is independent once 3.1/3.2 land:
  - `[P]` `agents/orchestrator.md`
  - `[P]` `skills/qa-review/SKILL.md`
  - `[P]` `skills/sprint-forge/SKILL.md`
  - `[P]` `skills/sprint-forge/assets/modes/close-sprint.md`
  - `[P]` `skills/sprint-forge/assets/modes/INIT.md`
  - `[P]` `skills/sprint-forge/assets/modes/analyze.md`
  - `[P]` `skills/sprint-forge/assets/modes/review-task.md`
  - `[P]` `skills/sprint-forge/assets/modes/plan-sprint.md`
  - `[P]` `skills/sprint-forge/assets/modes/recover.md`
  - `[P]` `skills/sprint-forge/assets/helpers/learner.md`
  - `[P]` `skills/sprint-forge/assets/modes/clarify.md`
  - `[P]` `skills/sprint-forge/assets/modes/execute-task.md`
  - `[P]` `skills/sprint-forge/assets/modes/STATUS.md`
  - `[P]` `skills/sprint-forge/assets/templates/archive-sprint.md`
  - Satisfies: Requirement "All projected CLI references SHALL resolve to a runnable invocation" (Scenario: "Source files keep the literal placeholder")
- [x] **3.4** Write `scripts/check-no-placeholder.mjs`: install into a temp HOME, assert zero `{{KYRO_CLI}}` matches under projected `{runtimeRoot}/{skills,commands,agents}/**`, and assert the inverse on source (`skills/**`, `agents/**` as shipped must contain the placeholder and must NOT contain a bare literal `kyro <subcommand>` invocation). Wire into `package.json` `check:*` scripts and the aggregate `npm run check`.
  - Satisfies: Requirement "All projected CLI references SHALL resolve to a runnable invocation" (Scenario: "No projected file leaks the raw placeholder")
  - Done: wired as `check:no-placeholder` in the aggregate `npm run check`; verified manually with a PATH-isolated temp-HOME install (node fallback form) — zero leaks, all 14 source files carry the placeholder.

**Work unit split (work-unit-commits):**
- Commit A: `feat(fs): add optional substitutions param to copy operations` (3.1 + 3.2, includes the plumbing).
- Commit B: `refactor(skills): replace literal kyro CLI references with {{KYRO_CLI}} placeholder` (3.3, all 14 files — one commit since it's one mechanical behavior, but flag for chained-PR review if diff exceeds budget alone).
- Commit C: `test(cli): add check-no-placeholder leak guard` (3.4).

**Dependency:** 3.1/3.2 must land before 3.4's projected-tree assertion is meaningful; 3.3 can be edited in parallel with 3.1/3.2 development but the projected output isn't correct until all three land together — do not merge 3.3 alone without 3.1/3.2, or the projected copies will still say `{{KYRO_CLI}}` (verified by 3.4).

---

## Phase 4 — codex adapter MCP command fix

- [x] **4.1** Update `src/cli/adapters/codex.ts` `buildMcpProjection` to call `resolveKyroInvocation()` and emit `command = inv.command`, `args = [...inv.args, 'mcp', 'serve']` instead of the static literal `command = "kyro"`.
  - Satisfies: Requirement "The codex MCP adapter SHALL register a runnable command, not a bare kyro reference" (both scenarios)
  - Done: TOML built with `JSON.stringify(command)` / `JSON.stringify(args)` per design §6.
- [x] **4.2** Update the codex MCP golden fixture to the resolved form; pin the fallback branch (force `kyroOnPath = false`) so the fixture is deterministic across machines (design §6).
  - Satisfies: same requirement
  - Done: the real assertion lives in `scripts/check-guardrails.mjs` `assertMcpProjection` (NOT `check-mcp.mjs`/`check-adapter-fixtures.mjs` as design §6/§10.1 stated — those never assert the MCP TOML content). Pinned determinism by installing with `PATH` set to an empty dir so `isKyroOnPath()` is false; asserts `command = "node"` + `args = ["~/.agents/kyro/current/dist/cli.js","mcp","serve"]`.

**Work unit:** one commit — `fix(codex-adapter): emit resolved kyroInvocation for MCP command instead of literal "kyro"`.

**Dependency:** requires Phase 2 (`resolveKyroInvocation`).

---

## Phase 5 — doctor `<invocation> --version` self-check

- [x] **5.1** Add `checkCliInvocation()` to `src/cli/commands/doctor.ts`: read `manifest.kyroInvocation` (fallback to `resolveKyroInvocation().raw` for legacy manifests missing the field), run `<invocation> --version` via `execFileSync` with a short timeout, pass on exit 0 + printed version, fail with remedy `"Re-run kyro install (or kyro sync) so the runtime CLI is projected and the invocation is refreshed."` otherwise. Place after `checkGlobalRuntime()` in the check list.
  - Satisfies: Requirement "doctor SHALL detect a non-runnable CLI invocation and report an actionable remedy" (both scenarios)
  - Done: `raw` split on whitespace into command+args, each segment `~`-expanded via `os.homedir()` (execFileSync does no shell expansion), 5s timeout, try/catch → fail (never crashes doctor). Placed after `checkGlobalRuntime()`.

**Work unit:** one commit — `feat(doctor): add CLI invocation self-check with actionable remedy`.

**Dependency:** requires Phase 1 (root `package.json` parity, so `--version` can resolve) and Phase 2 (`kyroInvocation` field).

---

## Phase 6 — Uninstall managedFiles coverage (regression only, no new code path)

- [x] **6.1** Add a regression assertion that a stale runtime version's projected `dist/` is reclaimed by `sync --prune`.
  - Satisfies: Requirement "Projected runtime SHALL bundle a runnable CLI" (Scenario: "Projected `dist/` is tracked and pruned with its runtime version")
  - **Finding (drove a spec correction):** the original scenario ("removed on uninstall") was based on a false premise. `uninstall` deliberately PRESERVES the global runtime — `src/cli/commands/uninstall.ts:50` prints "global runtime were preserved" and never consumes `manifest.managedFiles` for the versioned runtime (it removes only adapter-owned workspace entrypoints, or adapter assets under `--purge-adapter-assets`). Reproduced: after `uninstall` the entire `{runtimeRoot}/dist` tree stays intact. `managedFiles` IS complete (`install-plan.ts:134` registers all `dist/**`); uninstall simply does not delete the shared multi-version runtime by design.
  - **Resolution:** spec scenario rewritten to the real lifecycle — stale runtime versions (including their `dist/`) are reclaimed by `sync --prune`. Regression added to the existing sync-prune case in `scripts/check-adapter-fixtures.mjs`: a stale `versions/0.0.0/dist/cli.js` is seeded and asserted gone after `sync --prune`. No uninstall contract change.

**Work unit:** one commit — `test(uninstall): assert projected dist/ is fully removed on uninstall`.

**Dependency:** requires Phase 1.

---

## Phase 7 — Temp-HOME integration check + suite wiring + version sync

- [x] **7.1** Write `scripts/check-cli-bundle.mjs` per design §10.2: `mkdtemp` HOME + workspace, seed a fixture scope with a close-to-close `activeSprint`, install with `PATH` stripped of `kyro` and `HOME=tempHOME`, assert `kyroInvocation` is the node-fallback form in both `manifest.json` and `kyro.json`, assert projected-tree parity (`dist/cli.js`, `package.json`, `config.json`, `skills/...`), assert no `{{KYRO_CLI}}` leak, run `close-sprint --kyro-scope <fixture> --outcome shipped` via the resolved invocation, assert archive `.json`+`.md` written, `ledger[]` appended, `activeSprint === null`, exit `0`. Smokes `--version`.
  - Satisfies: Requirement "close-sprint SHALL complete end-to-end via the projected CLI without a PATH binary"; Requirement "PACKAGE_ROOT-relative assets SHALL resolve correctly when CLI is bundled" (close-sprint + --version)
  - Done: seeds from `fixtures/evals/close-sprint-happy/state`. INSTALL uses a PATH with neither `kyro` nor `node` (forces the persisted fallback); the RUN uses a PATH with `node` present but no `kyro` (a real agent's shell), executing the persisted `node ~/.agents/kyro/current/dist/cli.js` invocation with `~` expanded to the temp HOME.
- [x] **7.2** Add `check:cli-bundle` to `package.json` scripts and the aggregate `npm run check` (`check:no-placeholder` was already wired in 3.4).
  - Satisfies: Verification section of spec
  - Done: aggregate order keeps the build-then-check convention already relied on by `check:eval`/`check:cli-bundle-assets`; `check-cli-bundle.mjs` asserts `dist/cli.js` exists with a build hint if not.
- [x] **7.3** Version-sync the metadata files per CLAUDE.md checklist and add the CHANGELOG entry from design §9.
  - Satisfies: backward-compatibility notes in design §9 (release hygiene)
  - Done: bumped `package.json`, `.claude-plugin/plugin.json`, `WORKFLOW.yaml`, and `package-lock.json` to `4.12.0` (minor — new capability, backward-compatible with a one-time re-install). `marketplace.json` has no version field (only descriptions — left as-is; capability copy unchanged). CHANGELOG `[4.12.0]` entry added with the design §9 "Action required once" wording.
- [x] **7.4** Run full `npm run check` and `npm run typecheck` end-to-end and confirm all new/updated checks pass.
  - Satisfies: Verification section of spec

**Work unit split:**
- Commit A: `test(cli): add end-to-end check-cli-bundle integration check` (7.1).
- Commit B: `chore(scripts): wire check-cli-bundle and check-no-placeholder into check suite` (7.2).
- Commit C: `chore(release): version-sync metadata files and add CHANGELOG entry for bundled CLI` (7.3) — this is the release/ship commit, should be last.

**Dependency:** requires Phases 1–6 fully landed (this is the full end-to-end proof).

---

## Review Workload Forecast

| Phase | Est. changed lines | Notes |
|---|---|---|
| 0 | ~30–60 | Docs/notes only, no `src/` diff |
| 1 | ~90–140 | `install-plan.ts` additions + managedFiles + a check |
| 2 | ~140–190 | New `invocation.ts` module + `types.ts` additions + wiring |
| 3 | ~350–450 | 14-file mechanical edits (33 occurrences) + fs.ts/operation-steps.ts plumbing + new leak-guard script |
| 4 | ~60–90 | codex adapter fix + 2 fixture updates |
| 5 | ~50–80 | doctor self-check |
| 6 | ~30–50 | Regression assertion only |
| 7 | ~200–280 | New integration script + suite wiring + 4-file version sync + CHANGELOG |
| **Total** | **~950–1340** | Across the whole change |

- **Chained PRs recommended: Yes.** Total estimate is roughly 2.5–3x the 400-line single-PR budget, and Phase 3 alone (~350–450 lines across 16 files) is already at or over budget by itself.
- **400-line budget risk: High.** Even the smallest reasonable single-PR grouping (Phase 3 alone, or Phases 1+2 combined) sits near or over 400 lines; the full change is not single-PR viable without a `size:exception`.
- **Decision needed before apply: Yes.** Per `delivery_strategy = ask-on-risk`, stop before `sdd-apply` and ask the user whether to:
  1. Split into chained PRs along the phase boundaries above (Phase 0 → 1 → 2 → 3 → {4,5,6 in parallel} → 7), and if so, which chain strategy (`stacked-to-main` vs `feature-branch-chain`); or
  2. Proceed as a single PR with a recorded `size:exception`.
- Suggested chain grouping if chained PRs are chosen: **PR1** = Phase 0 (audit, near-zero risk, fast merge) + Phase 1 (dist/pkg/config projection); **PR2** = Phase 2 (invocation resolver + persistence); **PR3** = Phase 3 (placeholder substitution — the largest, isolate for focused review); **PR4** = Phases 4+5+6 (adapter fix, doctor check, uninstall regression — all depend on Phase 2, independent of each other, low individual risk, can be reviewed together or as 3 small PRs); **PR5** = Phase 7 (integration proof + suite wiring + release version-sync, must land last).
