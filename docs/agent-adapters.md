# Agent Adapters

Kyro's adapter contract is: global runtime, adapter command entrypoints, and local project state. Agents should invoke Kyro through command-like skills or slash commands, not by loading the full workflow manually.

## Stable interface

| Interface | Purpose |
|-----------|---------|
| `~/.agents/kyro/current/commands/*.md` | Thin command routers |
| `~/.agents/kyro/current/skills/sprint-forge/` | Lazy-loaded workflow modes, helpers, templates |
| `~/.agents/skills/kyro-*` | Standard global command skills discovered by compatible agents |
| `~/.claude/skills/kyro-*` | Native Claude Code command skills projected by the CLI |
| `~/.config/opencode/skills/kyro-*` | Native OpenCode command skills |
| `~/.config/opencode/commands/kyro/*.md` | Native OpenCode slash commands |
| `~/.config/opencode/opencode.json` `agent.kyro-orchestrator` | Kyro-owned OpenCode agent overlay |
| `.agents/kyro/project.json` + `local.json` | Layered project state (shared + personal; see [Teams](teams.md)) |
| `.agents/kyro/scopes/{scope}/` | Scope artifacts, state, summaries, roadmap, sprints |
| root `AGENTS.md` | Small Codex/cross-agent bootstrap when the Codex adapter is installed |

## Install adapters

```bash
npm install -g kyro-ai
# Run each adapter install from the project root.
cd /path/to/your-app
kyro install --scope workspace --init-workspace --yes
kyro install --agent opencode --scope workspace --init-workspace --yes
kyro install --agent codex --scope workspace --init-workspace --yes
kyro install --agent claude --scope workspace --init-workspace --yes
```

Implemented adapters:

| Adapter | Behavior |
|---------|----------|
| `standard` | Installs global `kyro-*` command skills for compatible agents. |
| `opencode` | Installs native OpenCode skills, `/kyro/*` command markdown, and a Kyro-owned `agent.kyro-orchestrator` overlay. |
| `codex` | Adds global command skills plus a small Kyro block in root `AGENTS.md`. |
| `claude` | Projects native Claude Code command skills from the shared runtime; no plugin installation. |

There is intentionally no generic adapter. Root `AGENTS.md` is the standard cross-agent bootstrap.

## Command intents

| Intent | Command skill | Slash namespace |
|--------|---------------|-----------------|
| forge | `kyro-forge` | `/kyro:forge` |
| status | `kyro-status` | `/kyro:status` |
| task context | `kyro-task-context` | `/kyro:task-context` |
| idea maturation and executable planning | `kyro-idea` | `/kyro:idea` |
| certification and quality audit | `kyro-qa` | `/kyro:qa` |
| human-gated retirement of an obsolete scope | `kyro-scope-retire` | `/kyro:scope-retire` |
| explicitly chosen Work task lifecycle | `kyro-work` | `/kyro:work` |

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

Use:

```bash
npm install -g kyro-ai
cd /path/to/your-app
kyro install --agent codex --scope workspace --yes
```

Codex reads the managed root `AGENTS.md` block, discovers `~/.agents/skills/kyro-*`, and follows the router-first workflow.

## OpenCode

Use:

```bash
npm install -g kyro-ai
cd /path/to/your-app
kyro install --agent opencode --scope workspace --yes
```

OpenCode should invoke the native `/kyro/forge`, `/kyro/status`, `/kyro/task-context`, `/kyro/idea`, `/kyro/qa`, `/kyro/scope-retire`, and explicitly chosen `/kyro/work` commands, or the installed `kyro-*` skills under `~/.config/opencode/skills/`. It should not copy Kyro core into the project.

Kyro preserves existing `opencode.json` content and owns only `agent.kyro-orchestrator`. MCP merge is not enabled until there is a concrete Kyro MCP server contract.

## Claude

Claude Code uses the same npm-installed Kyro CLI and single active runtime as other hosts:

```bash
npm install -g kyro-ai
cd /path/to/your-app
kyro install --agent claude --scope workspace --init-workspace --yes
kyro doctor --adapters
```

The adapter projects seven `kyro-*` router skills under `~/.claude/skills/`. Claude users can invoke `/kyro-forge`, `/kyro-status`, `/kyro-task-context`, `/kyro-idea`, `/kyro-qa`, `/kyro-scope-retire`, and `/kyro-work`. Internal workflow engines remain in `~/.agents/kyro/current/skills/` and are not public Claude commands. Use `kyro update` to adopt a later published package; the currently running CLI and projected skill pins should match.

### Migrating from the retired plugin

The former plugin commands `/kyro-ai:forge`, `/kyro-ai:status`, `/kyro-ai:task-context`, `/kyro-ai:idea`, `/kyro-ai:qa`, `/kyro-ai:scope-retire`, and `/kyro-ai:work` map by suffix to `/kyro-forge`, `/kyro-status`, `/kyro-task-context`, `/kyro-idea`, `/kyro-qa`, `/kyro-scope-retire`, and `/kyro-work`. First install the CLI adapter and verify the new skills in Claude Code. Then disable or uninstall the old Kyro plugin using Claude Code's plugin manager, and restart Claude Code if it still shows cached commands. Kyro deliberately does not edit `~/.claude/settings.json`, remove marketplace registrations, or delete any plugin cache; a legacy plugin may coexist and present duplicate or stale entrypoints until you remove it. Install and doctor warn when the standard Claude plugin registry visibly mentions `kyro-ai`, but an unrecognized registry layout may not be detected. Keep plugin removal user-controlled.

## Cursor

Cursor adapter automation is planned. Until then, use the standard install and root `AGENTS.md`/global skills if your Cursor setup can read them.

## Compatibility rule

Keep platform-specific behavior in adapters. The core workflow must remain portable through command routers, scoped state, summaries, and Markdown artifacts.


## Trace events

All adapters can inspect Kyro's append-only trace through `kyro trace`. Trace files live under `.agents/kyro/trace/{scope}/events.ndjson`, are best-effort, and are never used for routing. See [trace.md](trace.md).


## Portable guardrails

Adapters report guardrail enforcement tiers through `kyro doctor --adapters`. MCP-capable adapters receive host-native MCP registration so Kyro can enforce confirm-level operations through typed tools. Text-only adapters are reported honestly as advisory where an agent could pass `--yes` unattended. See [guardrails.md](guardrails.md).

The core deterministic gates (tool-owned write paths, policy `confirm`/`blocked` levels, and the maker/checker boundary) live in Kyro's CLI/MCP core and are portable to Claude, Codex, and OpenCode. The retired Claude plugin previously added two `PreToolUse` hooks for unbounded Bash search and writes near sprint close. The CLI adapter does not install these host-level interceptions: arbitrary shell commands outside Kyro's CLI are not blocked by Kyro. Use bounded search output and supported CLI verbs; do not describe removal of the hooks as equivalent host protection.
