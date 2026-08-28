# Kyro CLI

Kyro includes a small CLI for installing workspace harness assets, projecting command skills, and checking package/workspace health.

## Commands

```bash
kyro                    # Open the interactive TUI
kyro install            # Install standard .agents assets by default
kyro doctor             # Read-only package/workspace health check
kyro doctor --tokens    # Audit context/token budgets
kyro status             # Read-only brief status for the active Kyro scope
kyro status full        # Read-only phase/task summary and review debt
kyro status debt        # Read-only debt grouped by status and priority
kyro context-pack       # Emit a summary-first context package for a Kyro scope
kyro rule add           # Register a scope convention; optionally promote it globally
kyro capabilities       # List supported tool-owned verbs + version (runtime handshake)
kyro eval               # Run deterministic behavioral eval cases
kyro mcp serve          # Start the tools-only MCP stdio server
kyro scope set-active <scope> --yes  # Change active scope with guardrail confirmation
kyro scope complete --kyro-scope <scope> [--summary "..."] --yes  # Explicit scope completion
kyro scope reopen --kyro-scope <scope> --reason "..." --yes       # Return a completed scope to planning
kyro scope retire --kyro-scope <scope> --reason "..."  # Read-only retirement preparation
kyro repair integrity prepare --json                   # Read-only integrity diagnosis
kyro repair integrity apply --digest <sha256> --yes    # Digest-bound integrity apply
kyro trace              # Read append-only trace events for a scope
kyro sync               # Refresh managed workspace assets
kyro uninstall          # Remove managed workspace assets, preserving scope artifacts
```

`npx kyro-ai@latest` resolves to the same CLI entrypoint. Prefer **`@latest`** for install/sync so clients do not reuse a stale npx cache; pin an explicit version only when you need reproducibility.

### Interactive TUI by package root

The no-argument TUI is package-root-aware:

| CLI root | Available actions |
| --- | --- |
| Full npm package (`npx kyro-ai`, global package binary) | Install standard, OpenCode, or Codex adapter; Doctor; Exit |
| Projected runtime (`node ~/.agents/kyro/current/dist/cli.js`) | Doctor; Exit; full-package installation remedy |
| Unrecognized or corrupt root | Doctor; Exit; full-package recovery remedy |

The projected runtime is the canonical entrypoint for normal workflow commands, but it intentionally
cannot install or synchronize package assets. Run install/sync from `npx kyro-ai@latest` or a verified
global package instead. The restricted TUI never presents unavailable package actions and does not
acquire the writer lock merely to reject them.

## Maintenance Scripts

Kyro provides npm scripts for validating generated artifacts and adapter behavior. These are used both locally and in CI.

### `npm run check:dist`

Proves that the committed `dist/` matches a fresh build from current `src/`.

```bash
npm run check:dist
```

The script builds `dist/` into a temporary directory and compares it byte-for-byte with the existing `dist/`. It exits `0` when fresh and `1` when stale, printing the list of differing, missing, or extra files.

Run this after any source change that affects generated output, and always run it before committing or packing.

### `npm run check:adapters`

Runs adapter fixture validation against the built runtime.

```bash
npm run check:adapters
```

This exercises adapter detection, install plans, preflight, doctor output, JSON merge, managed block, and pipeline rollback behavior. It must pass before a release can be packed.

### Release gate ordering

The full release validation sequence is:

```bash
npm run build
npm run check        # typecheck + versions + links + runtime-artifacts + dist + budget-manifest + sprint-doctor-v4
npm run check:adapters
npm run check:tokens
npm run check:artifacts
npm pack --dry-run
```

See [`docs/release-checklist.md`](release-checklist.md) for the maintainer-facing checklist and policy.

## Install Scope

The default install scope is `workspace`, but Kyro now separates global runtime from project state.

Global runtime files are installed as a single active runtime:

```text
~/.agents/kyro/
└── current/
    ├── core/
    ├── commands/
    ├── skills/
    ├── dist/
    ├── package.json
    ├── config.json
    ├── KYRO.md
    └── manifest.json
```

Installing or syncing replaces `~/.agents/kyro/current/` with the current
package assets and removes the retired `~/.agents/kyro/versions/` layout. Kyro
does not keep local runtime-version history or old bundled binaries.

### Package vs projected runtime

Kyro has two CLI roots. They share the same `dist/cli.js` entrypoint but different on-disk layouts:

| Root | How you get it | Layout highlights |
| ---- | -------------- | ----------------- |
| **Full npm package** | `npx kyro-ai@latest …` or global `kyro` after `npm i -g kyro-ai` | Root `agents/`, `.claude-plugin/`, full package tree |
| **Projected runtime** | `node ~/.agents/kyro/current/dist/cli.js` (agent fallback when no durable `kyro` is on PATH) | `manifest.json`, `KYRO.md`, `core/agents/`, `core/WORKFLOW.yaml`, projected `skills/` + `dist/` — **not** a full package mirror |

### CLI invocation persistence (`kyroInvocation`)

**Source of truth is global only:** `~/.agents/kyro/current/manifest.json.kyroInvocation`.

Install/sync probe PATH once, write the result into the **runtime manifest**, and substitute it for `{{KYRO_CLI}}` in projected modes under `current/`. Project state files (`.agents/kyro/project.json`, `local.json`) do **not** store `kyroInvocation` (legacy copies are stripped on the next install/sync of that workspace). One machine-wide refresh is enough for all projects.

| Situation | Persisted invocation (manifest) |
| --------- | -------------------- |
| Durable global `kyro` on PATH (`npm i -g kyro-ai`, user shim under `~/.local/bin`, …) | `kyro` |
| No `kyro`, **or** only an ephemeral package-manager bin (npx/`_npx` cache, yarn dlx, pnpm dlx) | `node ~/.agents/kyro/current/dist/cli.js` |

**Why:** `npx kyro-ai@latest install` puts a temporary `…/.npm/_npx/…/bin/kyro` on PATH for the install process only. Treating that as durable used to persist bare `kyro`, which then failed for agents after npx exited and pushed them into hand-writing `sprint.json`. Ephemeral package-manager paths are rejected. Re-run `npx kyro-ai@latest sync` (or install) **once** (any workspace, or runtime-only install) so the global manifest and projected modes refresh; you do not need to visit every project just to fix the invocation string.

**Must run from the full npm package:**

- `install`, `sync`
- `doctor --tokens` (package token/budget audit)

**Safe from either root (including the projected runtime CLI):**

- `status`, `doctor`, `doctor --artifacts`, `analyze`, `repair`, `close-sprint`, `clarify`, `record-evidence`, `review`, `scenario add|link`, `scope retire`, `context-pack`, and other scope workflow commands

Root mode is fail-closed. A full package requires the root orchestrator and no projected markers; a projected runtime can retain its identity through any of `manifest.json`, `KYRO.md`, `core/agents/orchestrator.md`, or `core/WORKFLOW.yaml`. Conflicting or marker-less layouts are `unknown`, report an explicit doctor FAIL, and skip npm-package checks. Only a verified full package may run install/sync; projected or unknown roots return `INVALID_INPUT` with an actionable `npx kyro-ai@latest` remedy.

Global command skills are installed for agent discovery:

```text
~/.agents/skills/
├── kyro-forge/SKILL.md
├── kyro-status/SKILL.md
├── kyro-task-context/SKILL.md
├── kyro-scope-retire/SKILL.md
└── kyro-idea/SKILL.md
```

The project keeps only state and artifacts (layered):

```text
.agents/kyro/
├── project.json                 # SHARED — commit: principles, team policy, scopes registry cache
├── local.json                   # LOCAL — gitignored: activeScope, installedAdapters
├── .gitignore                   # install/sync assist (local-only files; never project.json/scopes/)
├── trace/{scope}/               # LOCAL — gitignored: append-only per-machine event log
└── scopes/
    └── {scope}/
        ├── sprint.json          # single source of truth
        ├── archive/             # write-only, at sprint close
        └── findings/            # write-only INIT analysis evidence
```

A host repository that ignores `.agents/` wholesale also shadows the nested `.gitignore` above, since
git never descends into an excluded directory — the shared artifacts then silently stop being
versioned and the scope is no longer reproducible from a clone. Exclude the local paths explicitly
instead (this repository's own `.gitignore` is a worked example):

```text
/.agents/*
!/.agents/kyro/
/.agents/kyro/*
!/.agents/kyro/project.json
!/.agents/kyro/scopes/
/.agents/kyro/**/trace/
/.agents/kyro/local.json
```

Full commit matrix, including migration off the pre-layered monolito: [Teams](teams.md).

## Adapters

Implemented workspace adapters:

| Adapter    | Purpose                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `standard` | Base `~/.agents/skills/kyro-*` command skill projection for compatible agents                                                |
| `opencode` | Native OpenCode skills, commands under `~/.config/opencode/commands/kyro/`, and `agent.kyro-orchestrator` in `opencode.json` |
| `codex`    | Codex adapter with projected Kyro command skills plus a managed root `AGENTS.md` block                                       |

Default install uses `standard`. **Always run install/sync from the project root:** global runtime and skills go under `~/.agents/…`; project state (`.agents/kyro/`) is created in the current working directory.

```bash
cd /path/to/your-app
npx kyro-ai@latest install --scope workspace --dry-run
npx kyro-ai@latest install --scope workspace --init-workspace --yes
```

`--init-workspace` non-interactively writes layered project state (`project.json` + `local.json`), ensures `.agents/kyro/.gitignore` for local-only files, and rehydrates on-disk `scopes/`. Without it, a non-interactive install may install only the global runtime. `--yes` alone does not initialize a new workspace.

Agent-specific installs (from the project root):

```bash
npx kyro-ai@latest install --agent opencode --scope workspace --init-workspace --yes
npx kyro-ai@latest install --agent codex --scope workspace --init-workspace --yes
npx kyro-ai@latest install --agent standard,opencode,codex --scope workspace --init-workspace --yes
```

The adapters project Kyro workflows into concrete agent entrypoints so compatible agents can discover command-like skills without asking the user to invoke Kyro through prose. `standard` and `codex` use `~/.agents/skills/`; OpenCode uses its native config tree and preserves non-Kyro `opencode.json` keys.

Projected skills:

- `kyro-forge`
- `kyro-status`
- `kyro-task-context`
- `kyro-idea`

Each projected skill references the managed Kyro runtime in `~/.agents/kyro/current/` instead of duplicating long workflow instructions.

## Uninstall

Default uninstall removes project bootstraps and adapter overlays, but preserves adapter entrypoint files:

```bash
kyro uninstall --yes
```

To remove adapter-owned entrypoint files as well:

```bash
kyro uninstall --purge-adapter-assets --yes
```

Purge removes only files declared by the installed adapter, then removes Kyro-owned directories if they are empty. Shared config files such as `~/.config/opencode/opencode.json` are preserved; Kyro removes only its owned overlay key.

The uninstall output includes a summary with overlay, purged file, and empty-directory counts.

## State Model

`kyro install` (with workspace init) and `kyro sync` write **layered** project state:

```text
.agents/kyro/project.json   # shared (commit)
.agents/kyro/local.json     # personal/machine (gitignored)
.agents/kyro/.gitignore     # local-only ignore assist
```

They do not create per-scope files. Each scope's `sprint.json` (the single source of truth for that scope) is created later by forge/INIT or `kyro plan`.

**Effective state** is a deterministic merge of shared + local (see [Teams](teams.md) for the pre-layered migration path). Readers use one façade (`readProjectState`); writers target the correct layer only.

**Rehydrate from disk:** if `.agents/kyro/scopes/{id}/` directories already exist (common after clone when scopes + `project.json` are committed but `local.json` is not), install/sync **registers** those folders into the shared scopes registry. Title and status come from each scope's `sprint.json` when readable; existing registry entries are never overwritten. `activeScope` is only auto-set when it is currently null and exactly one scope is known — with multiple scopes it stays null until `kyro scope set-active <scope> --yes`.

Bare interactive install (`npx kyro-ai@latest install`) asks whether to initialize the workspace; when scopes already exist on disk, the prompt lists them so a **y** answer registers them intentionally.

**Read-only commands never create state files** (`status`, `doctor`, `context-pack`). If layers are missing, they surface an install bootstrap remedy instead of writing `project.json` / `local.json` (D7a).

Initial **effective** shape after merge (no scopes on disk yet):

```json
{
  "schemaVersion": 4,
  "artifactRoot": ".agents/kyro/scopes",
  "scopes": [],
  "activeScope": null,
  "runtimePath": "~/.agents/kyro/current",
  "installedAdapters": []
}
```

Shared file omits `activeScope` / `installedAdapters`. Local file omits `principles` / `team`.

### Multi-developer note

`activeScope` is personal (who is working on what). The supported multi-dev model is:

| Commit | Do not commit |
| ------ | ------------- |
| `project.json`, `scopes/**`, `.agents/kyro/.gitignore` | `local.json` |

You no longer need to gitignore the entire `.agents/kyro/` tree. See [Teams](teams.md).

After clone:

1. `cd` into the cloned project root (not your home directory).
2. `npx kyro-ai@latest install --init-workspace --yes` (or interactive install and answer **y**) so layers exist here and scopes are registered.
3. If more than one scope: `kyro scope set-active <yours> --yes` (or the projected `node ~/.agents/kyro/current/dist/cli.js …` form).

`kyro doctor` validates layered shapes, WARNs on leftover live monolito when layers exist, WARNs on unregistered on-disk scopes, WARNs (global runs only) on directories under `scopes/` that hold no Kyro artifacts and were therefore ignored, and may WARN when `team.minPackageVersion` is newer than the runtime (non-blocking).

The project state intentionally does not copy runtime infrastructure fields. Kyro has one global active runtime: authoritative `packageVersion` and `kyroInvocation` live on `~/.agents/kyro/current/manifest.json`. Install and sync remove legacy project-local `runtimeVersion` and `kyroInvocation` while preserving scopes, principles, adapters, and custom metadata.

## Token Audit

Use `kyro doctor --tokens` to verify progressive-disclosure budgets:

- AGENTS Kyro block <= 150 words
- projected command skill <= 200 words
- command router <= 500 words
- mode file <= 900 words
- INIT mode <= 500 words
- each analysis helper <= 450 words
- startup, status brief, INIT happy path, and realistic forge/status runtime paths stay under estimated token budgets
- forbidden eager helper combinations fail the audit
- `sizingDecision` regression fixture stays internally consistent

Warnings mean Kyro still works, but the harness is becoming expensive to load. Failing sizing checks mean INIT can no longer prove its sprint boundaries.

## Status

Use `kyro status` when a human or script needs a read-only progress snapshot without loading agent routing context:

```bash
kyro status
kyro status brief --kyro-scope auth-refactor --json
kyro status full --kyro-scope auth-refactor
kyro status debt --kyro-scope auth-refactor --json
```

The command reads `.agents/kyro/scopes/<scope>/sprint.json` directly and derives display status from task state. It does not call `context-pack`, so it does not emit trace events. Brief JSON includes stable fields for scope, status, objective, active sprint, next action, next task, blockers, open debt count, and pending review count. Full mode adds phase/task summaries, review debt, ADR status counts, and recent ADRs. Debt mode groups debt by status and priority.

`kyro status` is not a mutation surface: `debt-add`, `debt-resolve`, and `debt-escalate` fail with `INVALID_INPUT`. Update debt through the workflow artifacts/gates, then re-run status to inspect it.

## Context Pack

Use `kyro context-pack` when an agent needs the minimal routing context for a scope without opening full Markdown files:

```bash
kyro context-pack --kyro-scope 01-token-cost-optimization
kyro context-pack --kyro-scope 01-token-cost-optimization --json
kyro context-pack --kyro-scope 01-token-cost-optimization --task T1.1
kyro context-pack --kyro-scope 01-token-cost-optimization --task
```

Use `--task` alone to default to the sprint's next pending task during active sprint execution.

The command reads the scope's structured artifact first:

- `sprint.json`

It emits scope status, next action, roadmap and sprint summaries, next task, artifact paths, compact rule summaries, ADRs, warnings, machine-checkable routing (`routing.modes`), budget routing (`budgetClass`, `reasoningTier`, `maxContextTokens`, `budgetGuidance`), and an estimated token total. Missing summaries produce warnings but still return a partial pack when possible. Unknown scopes fail with an actionable error.

Prefer `context-pack` over manual file selection at session start, after compaction, or when resuming a scope through summary-first routing.

JSON packs include `delegationEnabled` (boolean) from `local.json` `execution.delegationEnabled` — `false` when unset. When `true`, execute/review modes load delegate role helpers from `skills/sprint-forge/assets/delegates/`. See [Architecture — Delegated execution](architecture.md#delegated-execution-protocol-opt-in) and [Teams](teams.md).

## Artifact Integrity

Use `kyro doctor --artifacts` to validate the project knowledge contract:

```bash
kyro doctor --artifacts
kyro doctor --tokens --artifacts
kyro doctor --artifacts --kyro-scope auth-refactor
```

The audit validates project state, scoped `sprint.json` shape including ADR records, versioned lossless checkpoints, legacy ActiveSprint snapshots, archive narratives, and unresolved `[NEEDS CLARIFICATION]` markers. It also reports resumable and divergent close transactions. Managed scope roots, `sprint.json`, `archive/` directories and checkpoint candidates must be real paths inside the workspace: Doctor never follows symlinks, fails them for registered or Kyro-owned scopes, and reports unregistered foreign entries only as a global WARN.

Repair and normalize a scope's `sprint.json` without rewriting user-authored archives:

```bash
kyro repair --kyro-scope auth-refactor --dry-run
kyro repair --kyro-scope auth-refactor --yes
```

Scope lifecycle helpers:

```bash
kyro scope list
kyro scope inspect auth-refactor
kyro scope set-active auth-refactor --yes
kyro scope retire --kyro-scope legacy-auth --reason "Superseded by auth-refactor" --superseded-by auth-refactor
```

## Sync Semantics

`kyro sync` without `--agent` refreshes the adapters already recorded in local project state (`local.json` / effective `installedAdapters`).

It must not add the default `standard` adapter to an existing workspace unless the user explicitly passes it:

```bash
kyro sync
kyro sync --agent standard --dry-run
kyro sync --agent codex --dry-run
```

### Drift And Prune

`kyro sync` reports drift when a retired versioned runtime layout is still on
disk or old manifests point to obsolete Kyro-owned adapter entrypoint files.
Retired runtime directories are removed automatically by install/sync because
Kyro keeps only one active runtime.

Use prune to clean obsolete adapter-owned files during sync:

```bash
kyro sync --prune
```

`--prune` may remove:

- obsolete Kyro-owned adapter entrypoint files previously declared by old manifests:
  - `~/.agents/skills/kyro-*`
  - `~/.config/opencode/skills/kyro-*`
  - `~/.config/opencode/commands/kyro/*`

`--prune` preserves:

- current runtime files declared by the new manifest.
- project state, scopes, roadmap files, sprint files, and summaries under `.agents/kyro/scopes/`.
- shared agent config files such as `~/.config/opencode/opencode.json`.

If an old manifest lists shared config, sync reports it under `Shared config preserved` instead of pruning it.

`--prune` is different from `kyro uninstall --purge-adapter-assets`. Prune cleans adapter-file drift by comparing old manifests against the current install plan. Purge removes adapter entrypoint files during uninstall for adapters recorded in the installed project state. Neither mode removes shared user config.

## Claude Plugin Support

The Claude plugin adapter remains first-class through `.claude-plugin/`. The CLI does not replace it; it complements Kyro's adapter story for agents that need workspace-installed commands, skills, root `AGENTS.md` managed blocks, and core assets.

## Unsupported Generic Adapter

Kyro does not provide `--agent generic`. Cross-agent instructions belong in root `AGENTS.md`, and adapter installs should target concrete agent capabilities.

## Behavioral Evals

Use `kyro eval` to run deterministic agent-facing regression cases from `fixtures/evals/`. It supports `--case`, `--tag`, `--agent`, `--json`, `--list`, and `--keep-sandbox`. See [evals.md](evals.md).

## MCP Server

Use `kyro mcp serve` to expose Kyro operations as typed MCP tools over stdio. Use `kyro mcp tools` to print the catalog. See [mcp.md](mcp.md).


## Trace events

Use `kyro trace` to inspect append-only per-scope diagnostic events:

```bash
kyro trace --kyro-scope auth-refactor
kyro trace --kyro-scope auth-refactor --json --tail 20
kyro trace --kyro-scope auth-refactor --type close_snapshot
kyro doctor --trace --kyro-scope auth-refactor
```

Trace files are audit data only. They are never read for routing or workflow decisions. See [trace.md](trace.md).


## Portable guardrails

Kyro evaluates dangerous operations through a shared policy core. `scope set-active`, `scope complete` and `scope reopen` require `--yes`. `scope retire` is stricter: preparation is read-only, then apply requires the reviewed state-bound digest plus `--yes`; stale state returns `DIVERGED`, and missing confirmation returns `HUMAN_APPROVAL_REQUIRED`. MCP mutating tools use their existing two-phase `confirm: true` protocol. Use `kyro doctor --adapters` to see whether each adapter is `enforced` or `advisory` for guarded operations. See [guardrails.md](guardrails.md).

## Maker/checker review

`kyro review <task> [--kyro-scope <scope>] [--verdict pass|fail] [--finding severity:detail] [--by <actor>] --yes` writes task verdicts through the tool-owned checker boundary. `--dry-run` and `--yes` are mutually exclusive (preview or confirm, not both) — the same applies to `kyro close-sprint`. See [maker-checker.md](maker-checker.md).

`kyro close-sprint` is the only verb that confirms interactively. Outside a TTY (agent harness, CI, piped shell) it fails immediately with `CONFIRMATION_REQUIRED` instead of prompting for input that can never arrive — pass `--yes` to complete the gate non-interactively, or `--dry-run` to preview it.

Close requires every unfinished task to have a typed `task.disposition`. The persisted outcome is `shipped`/`completed` only when every task is `done` with a passing verdict; otherwise it is derived `partial` (or explicit `abandoned`). Dry-run, the narrative, the checkpoint `beforeClose` image, and the ledger entry all expose those dispositions. Closing a sprint never completes the scope: `handoff.nextAction` returns to `plan_sprint` so a later sprint can be materialized with `kyro plan --from`. Retirement remains the only terminal path.

## Runtime capability handshake (`kyro capabilities`)

`kyro capabilities [--json]` lists the tool-owned verbs this CLI exposes plus its version. The orchestrator runs it at forge start: a missing verb — or an `UNKNOWN_COMMAND` failure on the command itself — means the installed runtime predates the skill assets and the forge must abort with an upgrade request instead of improvising hand-edits. `kyro doctor` probes the installed runtime with the same handshake (`CLI capabilities` check).

The payload covers the sprint-lifecycle verbs plus the tool-owned state writers agents reach for (`clarify`, `scenario`, `adr`, `scope`, `status`). It excludes operator surface (`install`, `sync`, `uninstall`, `detect`, `eval`, `tui`, `mcp`, `trace`) and `capabilities` itself — the handshake cannot verify itself, since its absence is the staleness signal. `npm run check:capabilities` enforces both directions: every `{{KYRO_CLI}} <verb>` the shipped assets invoke must be advertised, and every advertised verb must be dispatchable.

## Explicit scope completion and reopen (`kyro scope complete` / `kyro scope reopen`)

A roadmap is an estimate, so closing its last sprint never completes a scope: a scope stays open for
planning until someone says otherwise. Completion is that explicit statement, and it is not
retirement — the scope stays in the work lifecycle and can be reopened later.

```bash
kyro scope complete --kyro-scope billing-api --summary "Objective met; nothing outstanding." --yes
kyro scope reopen   --kyro-scope billing-api --reason "Rounding regression found in production." --yes
```

Both are single locked transactions over `sprint.json` and the project registry, bound to a request
digest, idempotent and resumable (an identical retry after an interrupted apply finishes the
registry write instead of rewriting anything). Neither reads or rewrites `archive/`. Drop `--yes` to
see the plan and fail closed with `CONFIRMATION_REQUIRED`, or pass `--dry-run` to preview only.

`complete` refuses an active sprint, open debt, a done task without a pass verdict, blocking analyze
findings, and artifact divergence (`NOT_READY_TO_COMPLETE`, `BLOCKING_FINDINGS`, `DIVERGED`), then
records `completion` plus `status: completed` and `handoff.nextAction: done`.

`reopen` requires a non-empty `--reason`, refuses retired (`SCOPE_RETIRED`), already-open and
never-completed scopes (`SCOPE_ALREADY_OPEN`) and malformed state — each without writing. It clears
the live `completion`, appends it to append-only `completionHistory` together with the reason, and
returns the scope to `status: planning` / `handoff.nextAction: plan_sprint`, so the next sprint is
planned through the ordinary `kyro plan` route with no recovery or hand-edit. Completion history is
never pruned: `kyro scope inspect` prints it and `kyro context-pack` exposes it as `reopenHistory`.

Because both transitions move live state off the close checkpoint's after-image, `kyro doctor
--artifacts` does not trust the records it finds. It replays the recorded transitions from the
after-image through the same builders the writers use and accepts the live state only if one atomic
verification reproduces both `sprint.json` and the project registry exactly — reported as
`sprint=after (structurally replayed lifecycle; actor identity unverified)`. Any edit the claimed
transitions do not reproduce, and any corrupt immutable artifact, still fails closed as `DIVERGED`.

Two properties make that a verification rather than a restatement of the records, and both matter
once a scope goes round the cycle more than once:

- **Prefix exactness.** A scope may complete, reopen, plan, close, and complete again any number of
  times. Each close seals the `completionHistory` as it stood into its own after-image, so a replay
  starting from that image may only apply the *suffix* the live state adds on top of it. Re-applying
  the sealed prefix would double every earlier transition and report a lawful multi-cycle scope as
  `DIVERGED`. A live history that is not an exact extension of the sealed prefix — rewritten or
  truncated — is refused outright, and nothing replays.
- **Structurally bound suffix.** Every replayed record must carry `requestDigest` and
  `beforeEntryDigest`, and each must re-derive from the record's own content: the request digest from
  the scope plus the summary or the reason and the exact superseded completion, the registry digest
  from the entry the step started from. Missing, stale, partially edited, reordered, or misbound
  records fail closed. Records already sealed inside an immutable after-image are historical evidence
  and are not re-verified.

These SHA-256 values are public deterministic consistency bindings, not signatures. An editor able to
rewrite both durable layers can recompute them and produce a structurally valid projection; Kyro
cannot distinguish that from its own writer inside the same trust domain. `by` is self-asserted, so
neither actor identity nor process identity is authenticated. Repositories requiring adversarial
authenticity must protect history with signed commits or an external append-only store. See
[Lossless sprint-close checkpoints](sprint-close-checkpoints.md#lifecycle-verification-trust-boundary).

## Human-gated scope retirement (`kyro scope retire`)

Preparation is the default and never writes:

```bash
kyro scope retire --kyro-scope legacy-auth --reason "Superseded" --superseded-by auth-v2
```

It validates registration, absence of an active sprint, successor state and every close checkpoint;
prints current state, affected files and validations; fingerprints `archive/`; and returns a digest
bound to the exact inputs and observed sprint/project state. An agent must present that complete plan,
ask “¿Autorizas retirar el scope `<scope>` con este plan?”, and stop.

Only a later, unequivocal human approval permits:

```bash
kyro scope retire --kyro-scope legacy-auth --reason "Superseded" --superseded-by auth-v2 \
  --digest <reviewed-sha256> --yes
```

Apply rebuilds the plan under the state-writer lock, rejects stale/incorrect digests before writes,
publishes a resumable retirement checkpoint, CAS-updates `sprint.json` and project layers, clears
`local.json.activeScope` only when it points at the retired scope, and verifies `archive/` byte
identity. The terminal state is `status: retired`, `handoff.nextAction: done`, with reason,
application timestamp and optional successor in both live scope and registry metadata. Identical
retries are safe. Other state-writing verbs reject the terminal scope with `SCOPE_RETIRED`; its
read-only status, context, doctor, analyze and repair-plan surfaces remain available. Retirement is
never reachable from Forge, routing or handoffs.

## Tool-owned clarification resolution (`kyro clarify`)

`kyro clarify --from <resolutions.json> [--kyro-scope <scope>] [--dry-run]` resolves design ambiguity through the CLI; agents never edit `sprint.json` directly. The normal interaction asks one contextual question at a time, then writes one accepted answer. A batch is allowed only when the user explicitly asks to defer registration.

```json
{
  "resolutions": [
    {
      "target": { "kind": "open_question", "text": "Exact current open question" },
      "answer": "Accepted decision.",
      "requirements": [
        { "id": "R5", "statement": "Verifiable consequence.", "priority": "must" }
      ]
    }
  ]
}
```

Each target is either an exact `open_question` or a clarification `marker`. The command validates every resolution before writing; rejects duplicate, stale, empty, or malformed entries without changing state; appends the durable clarification record; and leaves `nextAction: clarify` until all questions and markers are resolved. Once clear, it routes to `plan_sprint` (no active sprint) or `execute_task` (an existing sprint).

## Tool-owned task evidence and disposition (`kyro record-evidence`)

`kyro record-evidence <task> --summary <text> --validation <text> [--file <path> ...] [--status done|blocked] [--disposition deferred|blocked|superseded|cancelled --reason <text> [--target debt:<id>|task:<id>|sprint:<n>]]` is the single maker write onto a located task. It never hand-edits `sprint.json`.

- Default `--status done` records evidence and routes to `review_task`. The checker verdict stays on `kyro review`.
- `--status blocked` without `--disposition` is the in-sprint block (still reviewable).
- `--disposition` records a typed terminal explanation for unfinished work. It requires a non-empty `--reason`. `deferred` and `superseded` also require `--target` (`debt:<id>` must exist in `debt[]`; `task:<id>` must be a different task in the sprint; `sprint:<n>` is a positive integer and may name a future sprint). Unknown kinds, blank reasons, `--status done`, and invalid targets fail with no write.
- A disposition is not `done` and not `pass`. Historical tasks omit the field.

See [adr-adaptive-sprint-lifecycle.md](plans/adr-adaptive-sprint-lifecycle.md) and [status-coherence.md](status-coherence.md).

## Tool-owned debt mutation (`kyro debt`)

`kyro debt <subcommand> [--kyro-scope <scope>] [--dry-run]` mutates `sprint.json.debt[]` deterministically, so the agent never hand-edits the fat `sprint.json` for debt. Debt is never deleted — only its status, priority, target sprint, or note change.

- `kyro debt add --title <text> --priority <critical|high|medium|low> [--target <n>] [--note <text>]` — appends a new item with a fresh, never-reused `debt-N` id, `status: open`, and `origin` set to the active sprint number.
- `kyro debt start <id>` — moves `open` or `deferred` to `in_progress`; refuses to restart a `resolved` item.
- `kyro debt resolve <id> [--note <text>]` — sets `status: resolved`, optionally replacing `note`.
- `kyro debt defer <id> --target <n> --note <text>` — sets `status: deferred`; both `--target` and a concrete `--note` are required.
- `kyro debt escalate <id> --priority <...>` — raises priority; refuses a same-or-lower priority.

Unknown ids fail with `DEBT_NOT_FOUND`. Run `kyro status debt` to inspect the result.

## Tool-owned emergent-task append (`kyro add-emergent`)

`kyro add-emergent --title <t> --description <d> --acceptance <a> [--acceptance <a> ...] [--file <p> ...] [--context <c>] [--depends-on <id> ...] [--kyro-scope <scope>] [--dry-run]` appends a task to `activeSprint.emergentTasks[]` deterministically, so the agent never hand-edits `sprint.json` for required work discovered mid-sprint. `--title`, `--description`, and at least one `--acceptance` are required. The new task gets a fresh, never-reused `E<N>` id, `status: pending`, `evidence: null`, `verdict: null` — `kyro record-evidence` and `kyro review` then operate on it exactly like a phase task. Each `--depends-on` must reference an existing task id (phase or emergent) already in the sprint, or the command refuses with `TASK_NOT_FOUND`; with no active sprint it refuses with `NO_ACTIVE_SPRINT`. Nothing is written on refusal.

## Tool-owned scenario graph (`kyro scenario`)

After a sprint is active, agents refine the requirement→scenario→task graph without hand-editing `sprint.json`:

```bash
kyro scenario add --id S10 --requirement R1 --given "…" --when "…" --then "…" [--kyro-scope <scope>] [--dry-run]
kyro scenario link --task T1.2 --scenario S10 [--kyro-scope <scope>] [--dry-run]
```

- **`add`** appends to `spec.scenarios`. The requirement id must already exist; scenario ids must be unique.
- **`link`** appends to an active-sprint task's `scenario_refs` (phase or emergent). Unknown task/scenario ids refuse with zero write.

Prefer these over whole-file mutate when analyze flags coverage gaps mid-sprint. See [spec-traceability.md](spec-traceability.md) for closed-sprint coverage (historical refs from ledger checkpoints do not re-fire MEDIUM after close).

## Tool-owned ADR append (`kyro adr add`)

```bash
kyro adr add --title "…" --context "…" --decision "…" \
  --consequence "…" [--consequence "…"] \
  --alternative "…" [--alternative "…"] \
  [--id ADR-0001] [--status accepted|proposed|rejected|superseded] [--date YYYY-MM-DD] \
  [--kyro-scope <scope>] [--dry-run]
```

Appends a full v4 `AdrRecord` to `sprint.adrs[]`. Prefer this over hand-editing ADR prose. Incomplete ADR objects fail validation with a full example shape and a `kyro adr add` remedy.

## Tool-owned rule registration (`kyro rule add`)

```bash
kyro rule add --rule "Keep the readiness checklist synchronized with verified evidence." \
  --tag process [--id process-1] [--kyro-scope <scope>] [--dry-run]

kyro rule add --rule "Run docs-check after OpenAPI changes." \
  --tag process --global [--kyro-scope <scope>] [--dry-run]
```

The default destination is `sprint.json.conventions[]` in the active (or only) scope. Agents must ask whether the user wants project-wide persistence before adding `--global`; that flag also writes the convention to shared `project.json.conventions[]`. `context-pack` merges global conventions into every scope, with scope-local rules winning duplicate ids or normalized text. Never create `RULES.md` or hand-edit either JSON file.

## Tool-owned scope bootstrap and sprint planning (`kyro plan`)

`kyro plan --from <file> [--kyro-scope <scope>] [--dry-run]` is tool-owned and validated, so the agent never hand-authors the full v4 `sprint.json` document. It has two modes, **auto-detected from the resolved scope's state** — not from the `--from` file's shape:

- **Init mode** — the scope has no `sprint.json` yet. Materializes the scope's initial `sprint.json` (spec + roadmap, `activeSprint: null`) from a compact lean plan JSON file. Refuses with `SCOPE_ALREADY_INITIALIZED` if the scope already has a `sprint.json` (never overwrites). Also registers the scope in the shared scopes registry on `project.json` (and sets local `activeScope` if unset). When either `git config user.name` or a schema-valid `user.email` resolves, writes optional `sprint.json.author` (`name?`, `email?`, `source: "git"`, `capturedAt`) with the available fields; drops malformed emails and omits the field when nothing usable remains. Author is best-effort only and **never blocks init**. Author is **not** accepted from the lean file.
- **Sprint mode** — the scope's `sprint.json` exists, `activeSprint` is `null`, and `handoff.nextAction === 'plan_sprint'`. Materializes the next `activeSprint` (all tasks `pending`, `evidence: null`, `verdict: null`) from a lean sprint-plan JSON file. Writes only `sprint.json` and **preserves** any existing `author`. Refuses with `SPRINT_ALREADY_ACTIVE` if a sprint is already active, or `NOT_READY_TO_PLAN` if the handoff isn't at `plan_sprint` yet (e.g. still `clarify`).

`[NEEDS CLARIFICATION]` markers are allowed in both modes' output (they legitimately route `handoff.nextAction` to `clarify`); this is separate from the O5 clarification gate on execute-phase commands. **Init mode** also routes to `clarify` when `spec.openQuestions` is non-empty (even without markers), so requirement-level questions drain before Sprint 1 planning.

### Init mode

Lean plan file shape:

```json
{
  "scope": "kebab-case-scope",
  "title": "Human title",
  "objective": "One sentence.",
  "successCriteria": ["...", "..."],
  "spec": {
    "requirements": [{ "id": "R1", "statement": "...", "priority": "must", "rationale": "..." }],
    "nonGoals": ["..."],
    "openQuestions": ["..."]
  },
  "roadmap": {
    "plannedSprintCount": 2,
    "sizingRationale": "...",
    "sprints": [{ "n": 1, "slug": "...", "title": "..." }]
  }
}
```

`scope` may be omitted from the file if `--kyro-scope` is given (and vice versa); if both are present they must agree. `spec` is optional; missing sub-arrays default to `[]`. `spec.scenarios` is never read from this file — init always writes `scenarios: []` (sprint mode adds scenarios later). Every `roadmap.sprints[]` entry needs `n`, `slug`, `title`; `roadmap.plannedSprintCount` must equal `roadmap.sprints.length`. Do not put `author` in the lean file — the CLI captures it from git at write time when available. Example written field:

```json
"author": {
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "source": "git",
  "capturedAt": "2026-07-24T18:30:00.000Z"
}
```

`kyro scope inspect` and `kyro status full` surface author when present; `status brief` does not.

### Sprint mode

Lean sprint-plan file shape (`--kyro-scope` is required — this file has no `"scope"` field):

```json
{
  "sprint": { "n": 1, "slug": "artifact-standard", "title": "Artifact standard", "objective": "One sentence." },
  "phases": [
    {
      "id": "P1", "title": "Phase title", "objective": "Phase objective",
      "tasks": [
        {
          "id": "T1.1", "title": "...", "description": "...", "files_to_touch": ["src/x.rs"],
          "context": "...", "acceptance_criteria": ["...", "..."], "depends_on": [], "scenario_refs": []
        }
      ]
    }
  ],
  "definitionOfDone": ["...", "..."],
  "scenarios": [{ "id": "S1", "requirement": "R1", "given": "...", "when": "...", "then": "..." }]
}
```

`sprint.n` must equal `(max n in sprint.ledger[]) + 1`, or `1` if the ledger is empty. Phase and task `id`s must be unique within the sprint; `depends_on` entries must reference a task `id` that exists in the same file. `scenarios` is optional; each `requirement` must reference an existing `spec.requirements[].id`, and each task's `scenario_refs` must reference a scenario `id` that exists after merging (existing `spec.scenarios` ∪ this file's `scenarios`, merged by `id` — new entries added, existing ones replaced). `definitionOfDone` is required and non-empty. The matching `roadmap.sprints[]` entry (by `n`) is set to `state: 'active'`; `debt[]` is left untouched (not auto-transitioned).

## Spec traceability

`kyro analyze` validates the optional `sprint.json.spec` graph: requirements, scenarios, task `scenario_refs`, open questions, and coverage gaps. `context-pack` surfaces requirements for scope packs and resolved scenarios for task packs. See [spec-traceability.md](spec-traceability.md).

## Legacy debt remediation and recertification (`kyro remediate`, `kyro recertify`)

A closed scope's history is immutable. Checkpoints, snapshots, narratives and ledger commitments are
never rewritten, not even to fix a record that is genuinely wrong. What *can* change is the live
canonical projection, and only through an append-only, explicitly typed, preconditioned correction
that leaves an immutable record of itself.

### What each version can repair

| Runtime | Operations | Repairs |
| --- | --- | --- |
| **4.43.5 and earlier** | `debt.origin.set` (protocol v1/v2) | A wrong or non-numeric `origin`, and nothing else. |
| **4.44.0 and later** (current: **4.47.3**) | adds `debt.canonicalize` (protocol v3) | A whole legacy debt record: broken or absent canonical fields *and* legacy-only keys such as `detail`, `resolution`, `addedSprint`. |

**Kyro 4.43.5 is origin-only and cannot repair a record-level legacy shape.** If a debt carries a
string `origin` *and* legacy-only keys *and* missing canonical fields — the shape real pre-contract
scopes have — `debt.origin.set` cannot fix it: setting `origin` leaves the legacy keys in place and
the canonical fields still absent. Upgrade to 4.44.0 or later. There is no automatic migration:
installing a newer Kyro never rewrites an existing scope, and Doctor never repairs one on your
behalf.

### The canonical debt contract

A canonical debt is exactly these seven keys, and nothing else:

```
id, title, origin, priority, status, targetSprint, note
```

`debt.canonicalize` produces exactly that set as an explicit after-image, and names the legacy-only
keys it retires. It is not a generic patch: it binds the whole observed debt with a SHA-256
precondition and resolves the record's field issues atomically or not at all.

### Operator authority

Kyro will *suggest* values it has evidence for, and will refuse to invent the rest.

- `origin` usually has real evidence — a legacy `addedSprint` — so preparation offers it as a
  suggestion.
- `priority` and `targetSprint` are business judgments. Kyro reports them as unresolved with **no**
  suggestion at all.

**A suggestion is never an authorization.** Only values you pass explicitly on the command line
become canonical values. Preparation with anything unsettled returns `INPUT_REQUIRED`, names every
unresolved field, and produces no manifest.

### The supported workflow

Every step below is copyable. Steps 1–3 write nothing at all.

```bash
# 1. See the problem. A legacy record makes this exit non-zero and names the offending field.
kyro doctor --artifacts --kyro-scope <scope>

# 2. Ask what must be decided. READ-ONLY. Returns INPUT_REQUIRED and lists unresolved fields.
kyro remediate canonicalize-prepare --debt D1 --kyro-scope <scope> \
  --reason "The record predates the canonical debt contract." --actor "<you>" --json

# 3. Decide explicitly, then save the manifest it prints. Still READ-ONLY — Kyro does not
#    save the manifest for you, so you review it before anything can be applied.
kyro remediate canonicalize-prepare --debt D1 --kyro-scope <scope> \
  --reason "The record predates the canonical debt contract." --actor "<you>" --json \
  --origin 1 --priority high --target-sprint null > prepared.json
#    ... extract .manifest into manifest.json and read it ...

# 4. Re-check the manifest against the state on disk, including the whole-debt digest. READ-ONLY.
kyro remediate canonicalize-preview --manifest manifest.json --kyro-scope <scope> --json

# 5. Apply. Requires --yes. Atomic: any failed digest, precondition, schema or post-write
#    check aborts the whole batch without advancing the scope.
kyro remediate apply --manifest manifest.json --kyro-scope <scope> --yes

# 6. Verify the chain replays to live state.
kyro doctor --artifacts --kyro-scope <scope>
kyro status --kyro-scope <scope>          # Verification: remediated

# 7. Record that the corrected state was independently validated.
kyro recertify apply --manifest certification.json --kyro-scope <scope> --yes
kyro status --kyro-scope <scope>          # Verification: recertified
```

### Expected failure boundaries

These are refusals by design, not bugs:

- **A stale manifest is refused.** If the debt changed since preparation, the whole-debt SHA-256
  precondition no longer holds and apply aborts without writing.
- **An incomplete manifest is refused.** `INPUT_REQUIRED` is terminal until you supply the values.
- **An interrupted apply resumes; it never duplicates.** Doctor reports `remediation/R-NNN:
  PREPARED`; re-running the same `remediate apply` finishes that record byte-for-byte and publishes
  no second `R-NNN`.
- **Older runtimes fail closed.** A v3 record is `unsupported` to a reader that predates it, rather
  than being partially understood.
- **A certificate must bind the current head.** Recertification is refused when the chain does not
  replay to live state, when the head has moved, when evidence is empty or does not re-derive, or
  when the verdict is not a pass.
- **Nothing is migrated automatically.** No install step and no Doctor run canonicalizes a legacy
  scope for you.

### Verification in Kyro Lens

Kyro Lens is a **read-only verifier**. It never applies, repairs, migrates or writes a scope, and it
does not trust the state label Kyro emits: it re-parses the artifacts, recomputes the commitments
and the replay, and reports what *it* derived. A record Lens cannot verify is shown as `diverged`,
`unsupported` or `corrupt` with an actionable diagnostic — never as a healthy fallback.
