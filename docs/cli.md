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
kyro eval               # Run deterministic behavioral eval cases
kyro mcp serve          # Start the tools-only MCP stdio server
kyro scope set-active <scope> --yes  # Change active scope with guardrail confirmation
kyro trace              # Read append-only trace events for a scope
kyro sync               # Refresh managed workspace assets
kyro uninstall          # Remove managed workspace assets, preserving scope artifacts
```

`npx kyro-ai` resolves to the same CLI entrypoint.

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

Global command skills are installed for agent discovery:

```text
~/.agents/skills/
├── kyro-forge/SKILL.md
├── kyro-status/SKILL.md
├── kyro-wrap-up/SKILL.md
├── kyro-task-context/SKILL.md
└── kyro-idea/SKILL.md
```

The project keeps only state and artifacts:

```text
.agents/kyro/
├── kyro.json                    # registry: scopes[], activeScope, principles[]
└── scopes/
    └── {scope}/
        ├── sprint.json          # single source of truth
        ├── archive/             # write-only, at sprint close
        └── findings/            # write-only INIT analysis evidence
```

## Adapters

Implemented workspace adapters:

| Adapter    | Purpose                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `standard` | Base `~/.agents/skills/kyro-*` command skill projection for compatible agents                                                |
| `opencode` | Native OpenCode skills, commands under `~/.config/opencode/commands/kyro/`, and `agent.kyro-orchestrator` in `opencode.json` |
| `codex`    | Codex adapter with projected Kyro command skills plus a managed root `AGENTS.md` block                                       |

Default install uses `standard`:

```bash
kyro install --scope workspace --dry-run
kyro install --scope workspace --yes
```

Agent-specific installs:

```bash
kyro install --agent opencode --scope workspace --yes
kyro install --agent codex --scope workspace --yes
kyro install --agent standard,opencode,codex --scope workspace --yes
```

The adapters project Kyro workflows into concrete agent entrypoints so compatible agents can discover command-like skills without asking the user to invoke Kyro through prose. `standard` and `codex` use `~/.agents/skills/`; OpenCode uses its native config tree and preserves non-Kyro `opencode.json` keys.

Projected skills:

- `kyro-forge`
- `kyro-status`
- `kyro-wrap-up`
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

`kyro install` creates only root project state:

```text
.agents/kyro/kyro.json
```

It does not create per-scope files. Each scope's `sprint.json` (the single source of truth for that scope) is created later by forge/INIT.

Initial state shape:

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

The project state intentionally does not copy the runtime version. Kyro has one global active runtime, so its authoritative version is `~/.agents/kyro/current/manifest.json.packageVersion`; install and sync remove the legacy project-local `runtimeVersion` field while preserving scopes, principles, adapters, and custom metadata.

## Token Audit

Use `kyro doctor --tokens` to verify progressive-disclosure budgets:

- AGENTS Kyro block <= 150 words
- projected command skill <= 200 words
- command router <= 500 words
- mode file <= 900 words
- INIT mode <= 500 words
- each analysis helper <= 450 words
- startup, status brief, INIT happy path, and realistic forge/status/wrap-up runtime paths stay under estimated token budgets
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

## Artifact Integrity

Use `kyro doctor --artifacts` to validate the project knowledge contract:

```bash
kyro doctor --artifacts
kyro doctor --tokens --artifacts
kyro doctor --artifacts --kyro-scope auth-refactor
```

The audit validates project state, scoped `sprint.json` shape including ADR records, versioned lossless checkpoints, legacy ActiveSprint snapshots, archive narratives, and unresolved `[NEEDS CLARIFICATION]` markers. It also reports resumable and divergent close transactions.

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
```

## Sync Semantics

`kyro sync` without `--agent` refreshes the adapters already recorded in `.agents/kyro/kyro.json`.

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

Kyro evaluates dangerous operations through a shared policy core. `scope set-active` now requires `--yes`; MCP mutating tools use the existing two-phase `confirm: true` protocol. Use `kyro doctor --adapters` to see whether each adapter is `enforced` or `advisory` for guarded operations. See [guardrails.md](guardrails.md).

## Maker/checker review

`kyro review <task> [--kyro-scope <scope>] [--verdict pass|fail] [--finding severity:detail] [--by <actor>] --yes` writes task verdicts through the tool-owned checker boundary. See [maker-checker.md](maker-checker.md).

## Spec traceability

`kyro analyze` validates the optional `sprint.json.spec` graph: requirements, scenarios, task `scenario_refs`, open questions, and coverage gaps. `context-pack` surfaces requirements for scope packs and resolved scenarios for task packs. See [spec-traceability.md](spec-traceability.md).
