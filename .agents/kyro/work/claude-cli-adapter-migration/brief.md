---
docType: plan
date: 2026-09-27
slug: claude-cli-adapter-migration
title: Migrate Claude from plugin distribution to a CLI-managed adapter
maturedFrom: mature
agents: []
---

# Migrate Claude from plugin distribution to a CLI-managed adapter

## Core thesis

Claude users should receive the same CLI-owned Kyro runtime, skill routing, updates, and diagnostics as other hosts. Removing the separately installed Claude plugin eliminates a second release channel and stale plugin caches, while a documented, non-destructive migration prevents existing users from losing access or seeing duplicate commands.

## Problem / Motivation

Claude currently exposes Kyro through plugin packaging while the CLI registry marks Claude as planned. Users must understand and update a second installation mechanism; a plugin cache may run a different version from the globally installed CLI. Plugin-only hooks and fallback paths make the source, package checks, and guidance diverge from the portable adapter model. Kyro's command routers and tool-owned CLI operations are now mature enough to make the plugin distribution unnecessary.

## Current-state evidence

- `src/cli/adapters/registry.ts` registers Claude as a planned adapter, while `src/cli/options.ts` rejects its installation and points users to the plugin.
- `src/cli/adapters/command-skills.ts` already builds version-pinned, router-first `kyro-*` skills for an arbitrary skill root; Codex and OpenCode consume this projection in `src/cli/adapters/codex.ts` and `src/cli/adapters/opencode.ts`.
- `src/cli/install-plan.ts` projects implemented adapters after installing the single active runtime; the installed manifest records managed assets. `src/cli/commands/uninstall.ts` and `src/cli/drift.ts` define cleanup and pruning behavior.
- `.claude-plugin/`, `providers/claude/commands/`, and `hooks/` are shipped by `package.json`; `scripts/check-claude-plugin-surface.mjs`, `scripts/check-bash-guard.mjs`, and `scripts/check-sprint-guard.mjs` test the plugin surface.
- `src/cli/commands/doctor.ts` and `scripts/check-versions.mjs` require plugin metadata. Runtime instructions in `agents/orchestrator.md` and three internal skills include `CLAUDE_PLUGIN_ROOT` fallback paths.
- `docs/agent-adapters.md` describes seven plugin commands and two Claude-only hooks. `docs/work.md` also routes Claude through the plugin.
- User decision: remove Claude plugin installation for the next release, make Claude operate like other clients, and retire the two Claude-only hooks. The user has not authorized a version bump, publication, global installation, commit, or push in this Work.

## Who it's for

Primary users are Claude Code users who want Kyro installed and updated through `kyro install` and `kyro update`, without managing a Claude marketplace. Maintainers need one source of truth and reproducible package checks. Existing plugin users need an explicit transition that identifies command-name changes and possible duplicates without silently changing their Claude settings.

## What success looks like

1. `kyro install --agent claude` previews and applies a confined, idempotent Claude projection; `sync`, `doctor`, and `uninstall` understand its managed assets without altering unrelated files.
2. Claude discovers all seven public Kyro command skills from its native skills root. Each loads the canonical runtime router; no plugin cache or plugin-only CLI fallback is needed.
3. The npm tarball no longer contains the Claude plugin manifest, marketplace listing, provider wrappers, or plugin-only hooks, and no active release or installation check requires them.
4. Existing plugin users receive actionable migration guidance. Kyro never deletes or disables a separately installed plugin automatically; a detected legacy plugin is reported as a duplicate-command risk until the user removes it using Claude's own mechanism.
5. Adapter and package regressions show normal Forge and Work CLI behavior unchanged. A plugin-free tarball installs and projects Claude in a disposable home/workspace. False success is detected if installation claims success while any required skill is absent, if `doctor` reports a broken projection healthy, or if a plugin asset remains in the package.

## Product laws / invariants

- The CLI-owned runtime at `~/.agents/kyro/current` is the sole Kyro runtime source of truth; this prevents host cache/version skew.
- Claude projection may own only explicitly enumerated `~/.claude/skills/kyro-*` files and any clearly delimited Kyro instructions chosen for the adapter. It must preserve user-authored Claude settings, commands, skills, and other agents' files.
- Work, Forge, Idea, QA, and other command routers retain their existing semantics. The host adapter changes discovery, not state contracts or approval gates.
- Installation and removal use the existing operation-plan, manifest, managed-path, and conflict checks. No direct write to Kyro-managed JSON or a hidden host-specific state writer is permitted.
- Plugin retirement does not uninstall or edit an external Claude plugin installation. Existing plugin activation is a migration warning, not authority for destructive cleanup.
- Removing the two Claude-only hooks does not weaken CLI-owned guards. Documentation must distinguish CLI-enforced checks from host-side Bash interception that will no longer exist.

## Observable success and failure guarantees

- Fresh Claude installation: preview lists all managed assets; apply makes seven skills discoverable; doctor validates each skill and runtime-version marker.
- Repeated install/sync: managed assets converge without duplicating blocks or changing unrelated Claude files.
- Missing or stale projected skill: doctor fails with a repair command; sync restores only Kyro-owned assets.
- Claude not installed or no project state: diagnostics name the state accurately and do not infer a healthy adapter from the presence of the Claude binary alone.
- Existing plugin detected: output explains the duplicate-command risk and user-controlled migration; Kyro does not remove plugin files or settings.
- Unsafe path, symlink, foreign file collision, or partial operation: the operation fails closed under existing path/operation safeguards rather than overwriting user data.
- Packaging without a plugin: version and bundle checks pass by validating the runtime and adapter contract, not by requiring deleted plugin files.

## Outcome-based scope

### In

- Implement Claude as an installable CLI adapter with skill projection, detection, managed-file metadata, diagnostics, and safe removal.
- Remove plugin manifests, marketplace metadata, provider wrappers, and plugin-only hook code/tests from active distribution.
- Remove plugin-only runtime fallbacks and active plugin-install instructions; update user, developer, release, and migration guidance in English.
- Replace plugin-specific checks with Claude adapter, migration, no-hook, and tarball-absence checks; validate coexistence with standard, Codex, and OpenCode adapters.

### Explicitly out

- No Work or Forge JSON schema change, no rewrite of historical changelog entries or archived plans, and no automatic Claude plugin uninstallation.
- No new Claude-specific host hooks, MCP behavior, or custom command namespace unless native skills cannot satisfy the seven command intents.
- No version bump, release branch, npm publication, global installation, commit, or push without separate authorization.
- No claim that Claude host UI discovery is proven by filesystem-only fixtures; real host smoke testing is a separate release gate.

## Closed decisions with rationale

1. **CLI-managed Claude adapter, not a plugin.** Evidence: other hosts already project command skills from one runtime. Tradeoff: users must install the npm CLI. Consequence: one update path and no plugin cache fallback.
2. **Native Claude skills as the public command surface.** Evidence: the shared projection emits all seven version-pinned router stubs, and Claude's skills root is represented in the existing registry. Tradeoff: invocation names shift from `/kyro-ai:*` to skill names such as `/kyro-forge`; migration documentation must state this explicitly. Consequence: no bespoke plugin wrappers.
3. **No silent removal of installed legacy plugins.** Evidence: Kyro's manifest does not own the user's Claude marketplace or plugin settings. Tradeoff: duplicate entrypoints may remain until a user acts. Consequence: warn with explicit instructions and avoid destructive writes.
4. **Retire both host-only hooks.** Rationale: the user accepted portable CLI enforcement as the governing contract. Tradeoff: arbitrary Claude Bash invocations no longer receive those extra plugin interceptions. Consequence: remove hook claims and retain CLI guard tests.
5. **Keep version 5.1.0 during implementation.** Rationale: release authorization is separate. Tradeoff: candidate code temporarily differs from published package. Consequence: test with workspace build and isolated tarball, never claim the global installation changed.

## Constraints and tradeoffs

- Preserve the exact seven command intents and router-first lazy loading; avoid exposing internal workflow engines as public Claude skills.
- Use the current adapter contract, operation planner, manifest ownership, and doctor convention; avoid a parallel Claude installer.
- Test against an isolated home and workspace so the developer's real `~/.claude` and global Kyro installation remain untouched.
- Existing `.claude-plugin` references in immutable historical notes may remain if clearly historical; active documentation and test assumptions must be current.
- A host may retain an older plugin and a new skill simultaneously. The adapter cannot control external plugin lifecycle; the migration must be explicit and observable.

## Risks, failure modes and degradation

| Trigger | Impact | Prevention or containment | Observable signal |
| --- | --- | --- | --- |
| New skills coexist with old plugin commands | Confusing duplicate Kyro entrypoints or stale execution | Detect/report legacy plugin when feasible; document user-controlled disable/uninstall; never mutate external settings | Install/doctor warning and migration guide |
| Skill projection collides with a user-owned path | User content overwritten | Existing managed-file conflict and path guards; regression with foreign file/symlink | Install fails with path-specific remedy; foreign bytes unchanged |
| Package/test still requires plugin manifest | Candidate cannot install or release | Update doctor/version/bundle checks and assert plugin-free tarball | `npm run check` or package fixture fails |
| Hidden plugin fallback remains in instructions | Agent runs stale code | Search active runtime sources, remove fallback, assert absence in startup fixture | Static regression or runtime invocation proof fails |
| Removing hooks is described as equal host interception | Misleading safety claim | Document the exact portable CLI boundary and absent host-side interception | Documentation audit fails |
| Claude-specific projection drifts from seven routers | Missing or stale command | Shared projection and doctor checking every expected skill | Adapter fixture fails; doctor failure |

## Execution blueprint

1. **Adapter contract and safe projection.** Inspect registry, operation planner, manifest, drift/uninstall, and adapter fixtures. Implement Claude using shared skill projection, explicit managed-file ownership, detection, and doctor. Gate: disposable install/sync/uninstall, collisions, idempotence, and coexistence pass.
2. **Retire plugin packaging and fallbacks.** Remove plugin manifests, wrappers, hooks, package entries, and active plugin checks. Update startup/doctor/version/bundle fixtures to assert the new contract and absent retired assets. Gate: build, targeted checks, and plugin-free tarball pass.
3. **Migration and documentation.** Update README, adapter/CLI/Work/guardrail/release guides and active agent instructions, keeping historical records intact. State command-name change, install/update path, user-controlled old-plugin removal, and removed-hook boundary. Gate: links, literals, and documentation checks pass.
4. **Integration certification.** Run full `npm run check`, `npm run check:adapters`, build/dist freshness, artifact doctor, analyze, isolated package smoke, and `git diff --check`. Compare Forge/Work behavior and unrelated bytes. Record each Work task's evidence and review via CLI only after proof. Gate: no unresolved blocking regression; otherwise fail review and amend through CLI.

## Acceptance and validation matrix

| Outcome or invariant | Scenario | Evidence required | Validation method |
| --- | --- | --- | --- |
| CLI-owned Claude installation | Fresh isolated Claude install projects seven router skills and a manifest entry | Operation preview, file list, doctor result | Disposable adapter fixture |
| Idempotent, confined ownership | Reinstall/sync/removal with unrelated Claude files and a foreign collision | Byte snapshots and conflict result | Disposable filesystem fixture |
| No plugin distribution | Build tarball excludes `.claude-plugin`, `providers/claude/commands`, and `hooks` | Tarball file list | `npm pack --dry-run --json` plus automated assertion |
| No stale fallback | Active runtime instructions and stubs resolve the CLI runtime without `CLAUDE_PLUGIN_ROOT` | Source scan and invocation fixture | Startup contract and targeted search |
| Migration safety | Legacy plugin presence does not cause automatic deletion or settings mutation | Before/after snapshots and warning | Adapter fixture and guide review |
| Router/CLI parity | Seven Claude skills map to existing routers; Forge/Work CLI checks remain green | Fixture output and full check results | Adapter, Work, Forge, and aggregate checks |
| Honest diagnostics | Missing/stale skill fails doctor; absent Claude install is not reported healthy | Structured check results | Doctor fixture |
| Safety boundary accuracy | Docs state that Claude-only Bash hooks are gone while CLI gates remain | Reviewed guide text and link check | Documentation inspection and `check:links` |

## Forge handoff

If a later team chooses Forge instead of the requested Work, the scope objective is: replace Claude plugin distribution with a CLI-owned adapter while preserving portable Kyro behavior and a safe migration for existing plugin users. Requirement candidates are the four workstreams above; non-goals are release/publishing, global installation, automatic legacy-plugin removal, and schema changes. Sequence adapter ownership before plugin retirement, then documentation and integration. The current user explicitly selected Kyro Work for execution, so no Forge scope is created by this plan.

## Quality gate

Rubric: thesis and causality 15/15; grounding and evidence 14/15; clarity and no ambiguity 14/15; observable outcomes 15/15; invariants and failures 10/10; decisions and tradeoffs 10/10; scope coherence 10/10; executable handoff 10/10. Total: **98/100**. Evidence reviewed: adapter registry and projections, install-plan, adapter fixtures, package manifest, active documentation, plugin files, and user decisions. No material contradiction remains. The host UI smoke test is a non-blocking release gate, not evidence claimed by this implementation plan.
