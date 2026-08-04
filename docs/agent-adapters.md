# Agent Adapters

Kyro's adapter contract is: global runtime, adapter command entrypoints, and local project state. Agents should invoke Kyro through command-like skills or slash commands, not by loading the full workflow manually.

## Stable interface

| Interface | Purpose |
|-----------|---------|
| `~/.agents/kyro/current/commands/*.md` | Thin command routers |
| `~/.agents/kyro/current/skills/sprint-forge/` | Lazy-loaded workflow modes, helpers, templates |
| `~/.agents/skills/kyro-*` | Standard global command skills discovered by compatible agents |
| `~/.config/opencode/skills/kyro-*` | Native OpenCode command skills |
| `~/.config/opencode/commands/kyro/*.md` | Native OpenCode slash commands |
| `~/.config/opencode/opencode.json` `agent.kyro-orchestrator` | Kyro-owned OpenCode agent overlay |
| `.agents/kyro/project.json` + `local.json` | Layered project state (shared + personal; see [Teams](teams.md)) |
| `.agents/kyro/scopes/{scope}/` | Scope artifacts, state, summaries, roadmap, sprints |
| root `AGENTS.md` | Small Codex/cross-agent bootstrap when the Codex adapter is installed |

## Install adapters

```bash
# Always from the project root. Always @latest unless you intentionally pin a version.
cd /path/to/your-app
npx kyro-ai@latest install --scope workspace --init-workspace --yes
npx kyro-ai@latest install --agent opencode --scope workspace --init-workspace --yes
npx kyro-ai@latest install --agent codex --scope workspace --init-workspace --yes
```

Implemented adapters:

| Adapter | Behavior |
|---------|----------|
| `standard` | Installs global `kyro-*` command skills for compatible agents. |
| `opencode` | Installs native OpenCode skills, `/kyro/*` command markdown, and a Kyro-owned `agent.kyro-orchestrator` overlay. |
| `codex` | Adds global command skills plus a small Kyro block in root `AGENTS.md`. |

There is intentionally no generic adapter. Root `AGENTS.md` is the standard cross-agent bootstrap.

## Command intents

| Intent | Command skill | Slash namespace |
|--------|---------------|-----------------|
| forge | `kyro-forge` | `/kyro:forge` |
| status | `kyro-status` | `/kyro:status` |
| task context | `kyro-task-context` | `/kyro:task-context` |
| idea maturation and executable planning | `kyro-idea` | `/kyro:idea` |
| certification and quality audit | `kyro-qa` | `/kyro:qa` |

Each skill loads its command router first. The router then names the exact mode/helper/template needed for the current step.

## Tool-owned CLI verbs

Beyond command-skill routing, Kyro ships tool-owned CLI verbs that mutate scope state deterministically instead of the agent hand-editing `sprint.json`. These run identically on every adapter — Codex and OpenCode invoke the same `kyro <verb>` commands through their shell tool that Claude does; none of this is Claude-only:

- `kyro plan --from <file> [--kyro-scope <scope>]` — bootstrap a scope's `sprint.json` (init mode) or materialize the next `activeSprint` (sprint mode)
- `kyro record-evidence <task> --kyro-scope <scope> ...` — record maker evidence on a task
- `kyro review <task> --kyro-scope <scope> --verdict pass|fail ...` — record a checker verdict
- `kyro debt add|start|resolve|defer|escalate` — mutate `sprint.json.debt[]`
- `kyro add-emergent --title <t> --description <d> --acceptance <a> ...` — append a task discovered mid-sprint

See [cli.md](cli.md) for full syntax and [maker-checker.md](maker-checker.md) for the evidence/review contract.

## Codex

Use:

```bash
npx kyro-ai@latest install --agent codex --scope workspace --yes
```

Codex reads the managed root `AGENTS.md` block, discovers `~/.agents/skills/kyro-*`, and follows the router-first workflow.

## OpenCode

Use:

```bash
npx kyro-ai@latest install --agent opencode --scope workspace --yes
```

OpenCode should invoke the native `/kyro/forge`, `/kyro/status`, `/kyro/task-context`, `/kyro/idea`, and `/kyro/qa` commands, or the installed `kyro-*` skills under `~/.config/opencode/skills/`. It should not copy Kyro core into the project.

Kyro preserves existing `opencode.json` content and owns only `agent.kyro-orchestrator`. MCP merge is not enabled until there is a concrete Kyro MCP server contract.

## Claude

Claude plugin support remains first-class through `.claude-plugin/`. The CLI adapter path complements the plugin; it does not retire it.

## Cursor

Cursor adapter automation is planned. Until then, use the standard install and root `AGENTS.md`/global skills if your Cursor setup can read them.

## Compatibility rule

Keep platform-specific behavior in adapters. The core workflow must remain portable through command routers, scoped state, summaries, and Markdown artifacts.


## Trace events

All adapters can inspect Kyro's append-only trace through `kyro trace`. Trace files live under `.agents/kyro/scopes/{scope}/trace/events.ndjson`, are best-effort, and are never used for routing. See [trace.md](trace.md).


## Portable guardrails

Adapters report guardrail enforcement tiers through `kyro doctor --adapters`. MCP-capable adapters receive host-native MCP registration so Kyro can enforce confirm-level operations through typed tools. Text-only adapters are reported honestly as advisory where an agent could pass `--yes` unattended. See [guardrails.md](guardrails.md).

The core deterministic gates (tool-owned write paths, policy `confirm`/`blocked` levels, the maker/checker boundary) live in Kyro's CLI/MCP core, so they are portable to Codex and OpenCode exactly as they are to Claude. Claude additionally ships two Claude Code plugin `PreToolUse` hooks — `guard-bash-output` (bounds unscoped recursive search) and `guard-sprint-close` (extra protection on writes near sprint close) — declared in `hooks/hooks.json` at the plugin root. These two hooks are Claude-only reinforcements, not part of the portability contract: Codex and OpenCode agents get the same CLI-enforced correctness guarantees, minus those two extra safety nets.
