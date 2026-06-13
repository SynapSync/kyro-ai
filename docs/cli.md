# Kyro CLI

Kyro includes a small CLI for installing workspace harness assets and checking health.

## Commands

```bash
kyro                    # Open the interactive TUI
kyro install            # Install adapter assets, OpenCode workspace by default
kyro doctor             # Read-only package/workspace health check
kyro sync               # Refresh managed workspace assets
kyro uninstall          # Remove managed workspace assets, preserving Kyro project state
```

`npx kyro-ai` also resolves to the same CLI entrypoint.

## Install Scope

The default install scope is `workspace`.

Workspace install writes project-local files so the repository carries its Kyro harness configuration:

```text
.agents/
├── kyro-ai/
│   ├── core/
│   ├── commands/
│   ├── skills/
│   ├── KYRO.md
│   └── manifest.json
├── skills/
│   ├── kyro-forge/SKILL.md
│   ├── kyro-status/SKILL.md
│   └── kyro-wrap-up/SKILL.md
└── core/
    └── kyro.json
```

## OpenCode Adapter

OpenCode and Codex are the workspace adapters implemented by the CLI:

```bash
kyro install --agent opencode --scope workspace --dry-run
kyro install --agent opencode --scope workspace --yes
kyro install --agent codex --scope workspace --yes
```

The adapters project Kyro workflows into `.agents/skills/` so compatible agents can discover command-like skills without asking the user to invoke Kyro through prose.

Projected skills:

- `kyro-forge`
- `kyro-status`
- `kyro-wrap-up`

Each projected skill references the managed Kyro core in `.agents/kyro/internal/` instead of duplicating long workflow instructions.

## State Model

`kyro install` creates only global project state:

```text
.agents/kyro/scopes/kyro.json
```

It does not create scoped state. Scoped state is created later when a scope is created or opened by a future scope/forge workflow.

Initial state shape:

```json
{
  "schemaVersion": 1,
  "artifactRoot": ".agents/kyro/scopes",
  "scopes": [],
  "activeScope": null,
  "installedAdapters": []
}
```

## Claude Plugin Support

The Claude plugin adapter remains first-class through `.claude-plugin/`. The CLI does not replace it; it complements Kyro's adapter story for agents that need workspace-installed commands, skills, root AGENTS.md managed blocks, and core assets.

## Unsupported Generic Adapter

Kyro does not provide `--agent generic`. Cross-agent instructions belong in the root `AGENTS.md` standard, and adapter installs should target concrete agent capabilities.
