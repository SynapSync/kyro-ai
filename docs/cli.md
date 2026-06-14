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
| `opencode` | OpenCode adapter using the same projected Kyro command skills |
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

The adapters project Kyro workflows into `~/.agents/skills/` so compatible agents can discover command-like skills without asking the user to invoke Kyro through prose.

Projected skills:

- `kyro-forge`
- `kyro-status`
- `kyro-wrap-up`

Each projected skill references the managed Kyro runtime in `~/.agents/kyro/current/` instead of duplicating long workflow instructions.

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

## Sync Semantics

`kyro sync` without `--agent` refreshes the adapters already recorded in `.agents/kyro/kyro.json`.

It must not add the default `standard` adapter to an existing workspace unless the user explicitly passes it:

```bash
kyro sync
kyro sync --agent standard --dry-run
kyro sync --agent codex --dry-run
```

## Claude Plugin Support

The Claude plugin adapter remains first-class through `.claude-plugin/`. The CLI does not replace it; it complements Kyro's adapter story for agents that need workspace-installed commands, skills, root `AGENTS.md` managed blocks, and core assets.

## Unsupported Generic Adapter

Kyro does not provide `--agent generic`. Cross-agent instructions belong in root `AGENTS.md`, and adapter installs should target concrete agent capabilities.
