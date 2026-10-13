# Agent Adapters

Kyro's adapter contract is: one global runtime, a machine-level adapter registry, canonical command skills, and local project state. Agents should invoke Kyro through command-like skills or slash commands, not by loading the full workflow manually.

## Stable interface

| Interface | Purpose |
|-----------|---------|
| `~/.agents/kyro/current/commands/*.md` | Thin command routers |
| `~/.agents/kyro/current/skills/sprint-forge/` | Lazy-loaded workflow modes, helpers, templates |
| `~/.agents/skills/kyro-*` | Canonical global command skills discovered by Codex, Pi, and compatible agents |
| `~/.agents/kyro/adapters.json` | Machine choices: enabled/disabled, projection mode, integrations |
| `~/.claude/skills/kyro-*` | Native Claude Code skills linked to the canonical skills (copy fallback) |
| `~/.config/opencode/skills/kyro-*` | Native OpenCode skills linked to the canonical skills (copy fallback) |
| `~/.config/opencode/commands/kyro/*.md` | Native OpenCode slash commands |
| `~/.config/opencode/opencode.json` `agent.kyro-orchestrator` | Opt-in Kyro-owned OpenCode agent overlay |
| `.agents/kyro/project.json` + `local.json` | Layered project state (shared + personal; see [Teams](teams.md)) |
| `.agents/kyro/scopes/{scope}/` | Scope artifacts, state, summaries, roadmap, sprints |
| root `AGENTS.md` | Opt-in Codex/cross-agent bootstrap in an initialized workspace |

## Install adapters

Install the npm CLI once, then initialize each project from its root:

```bash
npm install -g kyro-ai
cd /path/to/your-app
kyro install --init-workspace --yes
kyro adapters list
kyro doctor --adapters
```

One `kyro install` publishes canonical skills under `~/.agents/skills/` and projects all detected, enabled harnesses. For machine assets alone, use `kyro install --no-init-workspace`; it does not initialize project state. Install, sync, and update reconcile the same machine choices, including newly detected harnesses. They report `added`, `refreshed`, `unchanged`, `skipped(disabled)`, or `not-detected`, with the projection mode.

Detection uses a harness binary on PATH or its existing config directory:

| Adapter | Detection / discovery | Default behavior |
|---------|-----------------------|------------------|
| `standard` | Always enabled | Publishes canonical `~/.agents/skills/kyro-*`. |
| `claude` | `claude` or `~/.claude/` | Links `~/.claude/skills/kyro-*` to canonical skills; no plugin installation. |
| `codex` | `codex` or `~/.codex/` | Uses canonical skills directly. |
| `opencode` | `opencode` or `~/.config/opencode/` | Links native skills and writes `/kyro/*` command files. |
| `pi` | `pi` or `~/.pi/agent/` | Discovers canonical skills directly; creates no Pi-specific files. |

Undetected harness directories are not created. `--agent` is an explicit selection, not a requirement for discovery: `kyro install --agent claude` or `kyro sync --agent claude` re-enables Claude, but still requires detection and reconciles the other enabled harnesses too. Cursor remains planned and cannot be selected.

### Machine choices and migration

`~/.agents/kyro/adapters.json` (schema version 1) stores each adapter's `state`, `projection` (`link`, `copy`, or null), `integrations`, and `updatedAt`. It lives outside the replaced `current/` runtime, uses atomic writes under a machine lock, and supplies the runtime manifest's adapter list.

Legacy workspace `local.json.installedAdapters` is still read. Install/sync unions newly encountered legacy records into the machine registry with integrations enabled to preserve existing setup; existing machine choices take precedence. Install/sync stops writing `installedAdapters` to `local.json`. Visit each legacy workspace to migrate its records; another workspace no longer replaces the machine's choices.

A corrupt registry fails closed with `MACHINE_ADAPTER_REGISTRY_INVALID` and remains untouched. Follow the reported remedy: back up the registry, remove the invalid file, then initialize each legacy workspace again to rebuild it.

### Links, copies, and opt-out

Claude and OpenCode receive a directory link per command skill to the canonical directory of the same name. Previously Kyro-owned copies can become links. If symlinks are denied or unsupported, Kyro falls back to a version-pinned copy and reports `projection=copy`. Set `KYRO_LINK_MODE=copy` when a harness or filesystem needs copies. Sync/update refreshes them; doctor validates link targets and runtime pins. Foreign paths fail closed with the offending path and a remedy.

```bash
kyro adapters disable claude --dry-run
kyro adapters disable claude
kyro adapters enable claude
kyro adapters list --json
```

Disable removes only that harness's Kyro-owned projections and integrations and persists across install, sync, update, and other workspaces. It preserves canonical skills, which remain visible to Codex, Pi, and OpenCode through shared discovery. `standard` cannot be disabled. Enable restores a detected adapter. Mutating adapter commands support `--dry-run` without writing the registry or HOME assets.

### Integrations opt-in

Fresh installs leave `opencode.json`, `~/.codex/config.toml`, and workspace `AGENTS.md` unchanged unless integrations are enabled. OpenCode native command files remain part of the default projection. Opt in explicitly:

```bash
kyro adapters enable codex --integrations
kyro adapters enable opencode --integrations
# Or opt in for all detected adapters during installation:
kyro install --init-workspace --integrations --yes
```

Codex integration writes its MCP block and, in an initialized workspace, the managed root `AGENTS.md` block. OpenCode integration merges only `agent.kyro-orchestrator` into its existing settings. The registry preserves the opt-in for later reconciliations; disable removes integrations and clears that opt-in.

### Invocation by harness

| Harness | Work invocation | Other command pattern |
|---------|-----------------|-----------------------|
| Claude Code | `/kyro-work` | `/kyro-forge`, `/kyro-status`, etc. |
| Codex | `kyro-work` | Installed `kyro-forge`, `kyro-status`, etc. skills |
| OpenCode | `/kyro/work` | `/kyro/forge`, `/kyro/status`, etc. |
| Pi | `/skill:kyro-work` | `/skill:kyro-forge`, `/skill:kyro-status`, etc. |

These are host skill/command invocations; shell `kyro work ...` is the separate CLI lifecycle. Pi's `enableSkillCommands` controls interactive command discovery; manually entered skill commands still work. OpenCode may also see canonical skills through compatibility roots, so duplicate discovery can occur.

### Doctor and uninstall

`kyro doctor --adapters` reports one row per implemented adapter: standard, Claude, Codex, OpenCode, and Pi. Rows include detection, enabled/disabled state, projection health and relevant mode, with an exact remedy when needed. Disabled or undetected adapters pass as intentionally skipped; detected adapters with all command skills missing warn; partial projections, broken/foreign links, and stale runtime pins fail.

Workspace `kyro uninstall` preserves machine projections and home integrations, even with legacy `--purge-adapter-assets`. `kyro uninstall --machine` removes Kyro-owned canonical skills, harness projections, integration blocks (including the current workspace's block), and the machine registry. It preserves the global runtime, workspace state and scope artifacts, and unrelated user content. Preview either with `--dry-run`.

## Command intents

| Intent | Command skill | Runtime router |
|--------|---------------|-----------------|
| forge | `kyro-forge` | `commands/forge.md` |
| status | `kyro-status` | `commands/status.md` |
| task context | `kyro-task-context` | `commands/task-context.md` |
| idea maturation and executable planning | `kyro-idea` | `commands/idea.md` |
| certification and quality audit | `kyro-qa` | `commands/qa.md` |
| human-gated retirement of an obsolete scope | `kyro-scope-retire` | `commands/scope-retire.md` |
| explicitly chosen Work task lifecycle | `kyro-work` | `commands/work.md` |

Each skill loads its command router first. The router then names the exact mode/helper/template needed for the current step.

## Tool-owned CLI verbs

Beyond command-skill routing, Kyro ships tool-owned CLI verbs that mutate scope state deterministically instead of the agent hand-editing `sprint.json`. These run identically on every adapter — Codex and OpenCode invoke the same `kyro <verb>` commands through their shell tool that Claude does; none of this is Claude-only:

- `kyro plan --from <file> [--kyro-scope <scope>]` — bootstrap a scope's `sprint.json` (init mode) or materialize the next `activeSprint` (sprint mode)
- `kyro record-evidence <task> --kyro-scope <scope> ...` — record maker evidence on a task
- `kyro review <task> --kyro-scope <scope> --verdict pass|fail ...` — record a checker verdict
- `kyro debt add|start|resolve|defer|escalate` — mutate `sprint.json.debt[]`
- `kyro add-emergent --title <t> --description <d> --acceptance <a> ...` — append a task discovered mid-sprint
- `kyro scope complete --kyro-scope <scope> [--summary "..."] --yes` — explicit finished-scope completion, routed by Forge; not retirement
- `kyro scope retire --kyro-scope <scope> --reason <reason>` — prepare a read-only retirement plan for an obsolete/superseded/discarded scope;
  a human must approve its exact digest before the separate `--digest <sha256> --yes` apply

See [cli.md](cli.md) for full syntax and [maker-checker.md](maker-checker.md) for the evidence/review contract.

## Codex

Codex discovers `~/.agents/skills/kyro-*` and follows the router-first workflow. The managed root `AGENTS.md` block and MCP registration require integrations opt-in (or migrated legacy registration).

## OpenCode

OpenCode should invoke `/kyro/forge`, `/kyro/status`, `/kyro/task-context`, `/kyro/idea`, `/kyro/qa`, `/kyro/scope-retire`, and explicitly chosen `/kyro/work`, or its native skills under `~/.config/opencode/skills/`. It should not copy Kyro core into the project. Its optional agent overlay preserves non-Kyro settings; no OpenCode MCP registration is implemented.

## Pi

Pi discovers canonical skills without its own projection files. Invoke `/skill:kyro-work` for explicitly chosen Work and `/skill:kyro-forge` for Forge. See the invocation table for the discovery setting.

## Claude

Detected Claude Code receives seven `kyro-*` router skills under `~/.claude/skills/`. Invoke `/kyro-forge`, `/kyro-status`, `/kyro-task-context`, `/kyro-idea`, `/kyro-qa`, `/kyro-scope-retire`, and `/kyro-work`. Internal workflow engines remain under `~/.agents/kyro/current/skills/`. Use `kyro update` for published upgrades, then `kyro doctor --adapters` to verify projection health.

### Migrating from the retired plugin

The former plugin commands `/kyro-ai:forge`, `/kyro-ai:status`, `/kyro-ai:task-context`, `/kyro-ai:idea`, `/kyro-ai:qa`, `/kyro-ai:scope-retire`, and `/kyro-ai:work` map by suffix to `/kyro-forge`, `/kyro-status`, `/kyro-task-context`, `/kyro-idea`, `/kyro-qa`, `/kyro-scope-retire`, and `/kyro-work`. First install the CLI adapter and verify the new skills in Claude Code. Then disable or uninstall the old Kyro plugin using Claude Code's plugin manager, and restart Claude Code if it still shows cached commands. Kyro deliberately does not edit `~/.claude/settings.json`, remove marketplace registrations, or delete any plugin cache; a legacy plugin may coexist and present duplicate or stale entrypoints until you remove it. Install and doctor warn when the standard Claude plugin registry visibly mentions `kyro-ai`, but an unrecognized registry layout may not be detected. Keep plugin removal user-controlled.

## Cursor

Cursor adapter automation is planned. Until then, use the standard install and root `AGENTS.md`/global skills if your Cursor setup can read them.

## Compatibility rule

Keep platform-specific behavior in adapters. The core workflow must remain portable through command routers, scoped state, summaries, and Markdown artifacts.


## Trace events

All adapters can inspect Kyro's append-only trace through `kyro trace`. Trace files live under `.agents/kyro/trace/{scope}/events.ndjson`, are best-effort, and are never used for routing. See [trace.md](trace.md).


## Portable guardrails

Adapters report guardrail enforcement tiers through `kyro doctor --adapters`. MCP-capable adapters with integrations enabled receive host-native MCP registration so Kyro can enforce confirm-level operations through typed tools. Text-only adapters are reported honestly as advisory where an agent could pass `--yes` unattended. See [guardrails.md](guardrails.md).

The core deterministic gates (tool-owned write paths, policy `confirm`/`blocked` levels, and the maker/checker boundary) live in Kyro's CLI/MCP core and are portable to Claude, Codex, and OpenCode. The retired Claude plugin previously added two `PreToolUse` hooks for unbounded Bash search and writes near sprint close. The CLI adapter does not install these host-level interceptions: arbitrary shell commands outside Kyro's CLI are not blocked by Kyro. Use bounded search output and supported CLI verbs; do not describe removal of the hooks as equivalent host protection.
