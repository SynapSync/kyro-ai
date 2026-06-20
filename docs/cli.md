# Kyro CLI

Kyro includes a small CLI for installing workspace harness assets, projecting command skills, and checking package/workspace health.

## Commands

```bash
kyro                    # Open the interactive TUI
kyro install            # Install standard .agents assets by default
kyro doctor             # Read-only package/workspace health check
kyro doctor --tokens    # Audit context/token budgets
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
npm run check        # includes check:dist
npm run build
npm run check:adapters
npm run check:tokens
npm run check:artifacts
npm run check:artifact-fixtures
npm pack --dry-run
```

See [`docs/release-checklist.md`](release-checklist.md) for the maintainer-facing checklist and policy.

## Install Scope

The default install scope is `workspace`, but Kyro now separates global runtime from project state.

Global runtime files are installed once per Kyro version:

```text
~/.agents/kyro/
├── versions/
│   └── {version}/
│       ├── core/
│       ├── commands/
│       ├── skills/
│       ├── KYRO.md
│       └── manifest.json
└── current -> versions/{version}
```

Global command skills are installed for agent discovery:

```text
~/.agents/skills/
├── kyro-forge/SKILL.md
├── kyro-status/SKILL.md
└── kyro-wrap-up/SKILL.md
```

The project keeps only state and artifacts:

```text
.agents/kyro/
├── kyro.json
└── scopes/
    └── {scope}/
        ├── state.json
        ├── index.json
        ├── ROADMAP.md
        ├── ROADMAP.summary.json
        └── phases/
            ├── SPRINT-N-*.md
            └── SPRINT-N-*.summary.json
```

## Adapters

Implemented workspace adapters:

| Adapter | Purpose |
| --- | --- |
| `standard` | Base `~/.agents/skills/kyro-*` command skill projection for compatible agents |
| `opencode` | Native OpenCode skills, commands under `~/.config/opencode/commands/kyro/`, and `agent.kyro-orchestrator` in `opencode.json` |
| `codex` | Codex adapter with projected Kyro command skills plus a managed root `AGENTS.md` block |

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

It does not create scoped state. Scoped state, indexes, and summaries are created later when a scope is created or opened by forge/INIT.

Initial state shape:

```json
{
  "schemaVersion": 1,
  "artifactRoot": ".agents/kyro/scopes",
  "scopes": [],
  "activeScope": null,
  "runtimeVersion": "3.2.2",
  "runtimePath": "~/.agents/kyro/current",
  "installedAdapters": []
}
```


## Token Audit

Use `kyro doctor --tokens` to verify progressive-disclosure budgets:

- AGENTS Kyro block <= 150 words
- projected command skill <= 200 words
- command router <= 500 words
- mode file <= 900 words
- INIT mode <= 500 words
- each analysis helper <= 450 words
- ROADMAP template <= 450 words
- REENTRY template <= 350 words
- startup, status brief, and INIT happy paths stay under their estimated token budgets
- `sizingDecision` regression fixture stays internally consistent

Warnings mean Kyro still works, but the harness is becoming expensive to load. Failing sizing checks mean INIT can no longer prove its sprint boundaries.


## Artifact Integrity

Use `kyro doctor --artifacts` to validate the project knowledge contract:

```bash
kyro doctor --artifacts
kyro doctor --tokens --artifacts
kyro doctor --artifacts --kyro-scope auth-refactor
```

The audit validates project state, scoped `state.json`, `index.json`, roadmap/sprint summaries, source Markdown references, stale summaries, and active sprint pointers. Missing summaries warn; invalid JSON and broken state references fail.

Repair JSON summaries from Markdown without rewriting Markdown:

```bash
kyro repair --kyro-scope auth-refactor --dry-run
kyro repair --kyro-scope auth-refactor --yes
```

Scope lifecycle helpers:

```bash
kyro scope list
kyro scope inspect auth-refactor
kyro scope set-active auth-refactor
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

`kyro sync` reports drift when old manifests point to stale runtime versions or obsolete Kyro-owned adapter entrypoint files.

Use prune to clean drift during sync:

```bash
kyro sync --prune
```

`--prune` may remove:

- stale runtime version directories under `~/.agents/kyro/versions/`, except the current package version.
- obsolete Kyro-owned adapter entrypoint files previously declared by old manifests:
  - `~/.agents/skills/kyro-*`
  - `~/.config/opencode/skills/kyro-*`
  - `~/.config/opencode/commands/kyro/*`

`--prune` preserves:

- current runtime files declared by the new manifest.
- project state, scopes, roadmap files, sprint files, and summaries under `.agents/kyro/scopes/`.
- shared agent config files such as `~/.config/opencode/opencode.json`.

If an old manifest lists shared config, sync reports it under `Shared config preserved` instead of pruning it.

`--prune` is different from `kyro uninstall --purge-adapter-assets`. Prune cleans sync drift by comparing old manifests against the current install plan. Purge removes adapter entrypoint files during uninstall for adapters recorded in the installed project state. Neither mode removes shared user config.

## Claude Plugin Support

The Claude plugin adapter remains first-class through `.claude-plugin/`. The CLI does not replace it; it complements Kyro's adapter story for agents that need workspace-installed commands, skills, root `AGENTS.md` managed blocks, and core assets.

## Unsupported Generic Adapter

Kyro does not provide `--agent generic`. Cross-agent instructions belong in root `AGENTS.md`, and adapter installs should target concrete agent capabilities.
