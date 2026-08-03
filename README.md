<p align="center">
  <h1 align="center">Kyro AI</h1>
</p>

<p align="center">
  <a href="https://github.com/SynapSync/kyro-ai/stargazers"><img src="https://img.shields.io/github/stars/SynapSync/kyro-ai?style=for-the-badge&logo=github&color=D97757&labelColor=1e1e2e" alt="Stars"/></a>
  <a href="https://www.npmjs.com/package/kyro-ai"><img src="https://img.shields.io/npm/v/kyro-ai?style=for-the-badge&logo=npm&color=E8926F&labelColor=1e1e2e" alt="npm"/></a>
  <a href="https://github.com/SynapSync/kyro-ai/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-22c55e?style=for-the-badge&labelColor=1e1e2e" alt="License"/></a>
  <a href="https://github.com/SynapSync/kyro-ai/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/SynapSync/kyro-ai/ci.yml?style=for-the-badge&logo=githubactions&logoColor=white&label=CI&labelColor=1e1e2e" alt="CI"/></a>
</p>

<p align="center">
  <b>Shared sprint workflow for AI coding agents — install once, every agent uses the same source of truth.</b><br/>
  Portable markdown core &bull; tool-owned CLI gates &bull; project-local state &bull; host adapters
</p>

---

## What You Get

Kyro is a **sprint harness** for AI coding agents. Install once, every agent uses the same source of truth:

- **Shared sprint cycle** — all agents follow init → plan → execute → review → close (gates enforced in code)
- **One scope file** — `.agents/kyro/scopes/{scope}/sprint.json` is the single source of truth
- **CLI-owned state** — schema and gates run every time; agents can't invent enums or hand-edit
- **Team-safe by default** — commit `project.json` + scopes; each dev has personal `local.json`
- **5 slash commands** — `/kyro:forge` (full cycle), `/kyro:status`, `/kyro:qa`, `/kyro:idea`, `/kyro:task-context`

**Why it matters:** AI agents forget context, invent process, and edit planning files by hand. Across Claude, Codex, OpenCode, and others you re-explain the same workflow every session. Kyro stops this.

---

## Quick start

**Requirements:**
- Node.js ≥ 18
- Git
- Claude Code, Codex, OpenCode, or similar agent (must support plugins or skills)

### Claude Code (Plugin)

**Step 1: Add the marketplace**

```
/plugin marketplace add SynapSync/kyro-ai
```

**Step 2: Install the plugin**

```
/plugin install kyro-ai
```

**Step 3: Reload plugins**

```
/reload-plugins
```

**Step 4: Start your first sprint**

```
/kyro:forge implement OAuth2 authentication
```

You'll see the full cycle:

```text
INIT      objective + success criteria
─ gate ─  proceed / adjust / cancel?
PLAN      sprint tasks
─ gate ─  proceed / adjust / cancel?
EXECUTE   evidence via CLI (not hand JSON)
REVIEW    checker verdict via CLI
CLOSE     lossless checkpoint + ledger

state ›  .agents/kyro/scopes/oauth2-auth/sprint.json
```

That's it! The plugin works standalone. No extra setup needed.

---

### Claude Code (npx alternative)

If you prefer not to use the plugin, or you're working in a team repo, install via npm:

```bash
cd /path/to/your-project
npx kyro-ai@latest install --init-workspace --yes
```

Then use Kyro commands from the terminal or via agent skills under `~/.agents/skills/kyro-*`.

---

### Teams: Initialize shared project state

If your team shares the repo and you want everyone on the same `project.json`, run once from the project root:

```bash
cd /path/to/your-project
npx kyro-ai@latest install --init-workspace --yes
```

This creates:
- `.agents/kyro/project.json` — shared, committed (team constitution + scopes registry)
- `.agents/kyro/local.json` — personal, gitignored (your active scope)

If scopes already exist from teammates, this registers them. Then set your active scope:

```bash
kyro scope set-active <scope> --yes
```

---

### Verify installation

```bash
npx kyro-ai@latest doctor
```

Or if installed globally:

```bash
kyro doctor
```

---

## Installation by host

| Host | How to install | Invocation |
| ---- | --------------- | ---------- |
| **Claude Code** ⭐ | **Plugin** (recommended): `/plugin marketplace add SynapSync/kyro-ai` → `/plugin install kyro-ai` → `/reload-plugins` | `/kyro:forge`, `/kyro:status`, `/kyro:qa`, `/kyro:idea`, `/kyro:task-context` |
| **Claude Code** (npx) | From project root: `npx kyro-ai@latest install --init-workspace --yes` | Commands via terminal or `~/.agents/skills/kyro-*` |
| **Codex** | From project root: `npx kyro-ai@latest install --agent codex --init-workspace --yes` | Skills `kyro-*` (auto-loaded in root `AGENTS.md`) |
| **OpenCode** | From project root: `npx kyro-ai@latest install --agent opencode --init-workspace --yes` | Native `/kyro/*` commands |
| **Cursor / Others** | From project root: `npx kyro-ai@latest install --init-workspace --yes` | `kyro-forge`, `kyro-status` … under `~/.agents/skills/` |

**Notes by host:** [Agent adapters](docs/agent-adapters.md) · [Codex guide](docs/HOW-TO-USE-CODEX.md) · [OpenCode guide](docs/HOW-TO-USE-OPENCODE.md)

### For local development

Clone and build from source:

```bash
git clone https://github.com/SynapSync/kyro-ai.git
cd kyro-ai && npm install && npm run build
claude --plugin-dir /path/to/kyro-ai
```

---

## Typical flows

**Use it when you want to...**

| Scenario | Command |
| -------- | ------- |
| Start a new feature sprint | `/kyro:forge implement email notifications` |
| Check progress on current work | `/kyro:status` |
| Get a summary before switching contexts | `/kyro:task-context` (copy-paste into a fresh session) |
| Audit code & architecture independently | `/kyro:qa` (runs outside the forge cycle) |
| Mature a rough idea into a plan | `/kyro:idea design a rate-limiting strategy` |
| Record evidence on a task | `kyro record-evidence <task> --evidence "…"` |
| Mark a task complete after review | `kyro review <task> --verdict pass` |
| Track technical debt | `kyro debt add --title "refactor auth" --tag database` |
| Wrap up a sprint | `kyro close-sprint --outcome success` |

---

## Day-to-day workflow

### Commands (routers)

Thin routers over scope state — they load only what the current step needs.

| Command / skill | Role |
| --------------- | ---- |
| `/kyro:forge` · `kyro-forge` | Full cycle: analyze → plan → execute → review → close (gates) |
| `/kyro:status` · `kyro-status` | Progress, roadmap, debt (`brief` / `full` / `debt`) |
| `/kyro:idea` · `kyro-idea` | Optional pre-scope: mature an idea into an execution-ready brief |
| `/kyro:qa` · `kyro-qa` | Independent certification audit (not the forge review gate) |
| `/kyro:task-context` · `kyro-task-context` | Copy-paste prompt to continue in a fresh context |

### Tool-owned CLI (required for state changes)

**Do not hand-edit** `.agents/kyro/scopes/*/sprint.json` or invent enums. Mutate state with the CLI so schema and gates run every time.

| Verb | Purpose |
| ---- | ------- |
| `… plan --from <file>` | Bootstrap scope or materialize the next sprint |
| `… record-evidence <task> …` | Maker evidence on a task |
| `… review <task> --verdict pass\|fail …` | Checker verdict |
| `… debt add\|start\|resolve\|…` | Formal debt lifecycle |
| `… rule add --rule "…" --tag process [--global]` | Register a scope rule; optionally promote it to every scope |
| `… close-sprint --outcome …` | Lossless close + checkpoint (never null `activeSprint` by hand) |
| `… context-pack --json` | Lean read for routing (prefer over opening full `sprint.json`) |
| `… doctor` / `… doctor --artifacts` | Health and artifact shape |
| `… analyze` | Semantic gates before close |

Replace `…` with your persisted invocation (`kyro`, or `node ~/.agents/kyro/current/dist/cli.js`). Full flags: [CLI](docs/cli.md).

### How routing works

```text
read project state (project.json + local.json) + scopes/{scope}/sprint.json (prefer context-pack)
  → route on handoff.nextAction
    (init → clarify → plan_sprint → execute_task → review_task → close_sprint → done | recover)
  → load only that mode/helper
  → one tool-owned write
```

Unknowns become `[NEEDS CLARIFICATION]` markers; `doctor` / `analyze` fail until they are resolved.

---

## What lives where

**Global runtime** (machine-local, replaced on install/sync):

```text
~/.agents/kyro/current/     # commands, skills core, dist/cli.js, manifest.json
~/.agents/skills/kyro-*/    # command skill stubs (standard)
```

**Project** (layered state — team-safe by default):

```text
.agents/kyro/
├── project.json              # SHARED — commit: principles, global conventions, team policy, scopes cache
├── local.json                # LOCAL — gitignored: activeScope, installedAdapters
├── .gitignore                # written by install/sync (local.json, legacy kyro.json, locks)
└── scopes/{scope}/           # SHARED — commit sprint artifacts
    ├── sprint.json           # single source of truth for the scope
    ├── archive/              # write-only at close
    └── findings/             # write-only INIT evidence
```

| Path | Commit? | Holds |
| ---- | ------- | ----- |
| `project.json` | **Yes** | Team constitution (`principles`), global `conventions`, optional `team.minPackageVersion`, scopes registry cache |
| `local.json` | **No** (gitignored) | Personal `activeScope`, machine `installedAdapters` |
| `scopes/**` | **Yes** | Sprint work shared by the team |
| Legacy `kyro.json` | **No** | Pre-layered monolito; dual-read until install migrates it to layers |

CLI invocation is **global** (`~/.agents/kyro/current/manifest.json`), never stored on project files.

Also includes (power users): behavioral evals, MCP (`kyro mcp serve`), append-only trace, portable guardrails — see docs map below. Full multi-dev contract: [Teams](docs/teams.md).

---

## Upgrade, teams, multi-dev

```bash
# From the project root — refresh runtime + projected skills after a Kyro release
cd /path/to/your-app
npx kyro-ai@latest sync --scope workspace --yes
```

| Pattern | Guidance |
| ------- | -------- |
| **Working directory** | Always install/sync from the **project root**. Global runtime is shared; `.agents/kyro/` is per-cwd. |
| **Upgrade** | Always `npx kyro-ai@latest sync` (or re-`install`) from that root so you get the newest package and refresh the global runtime / projected modes. `kyroInvocation` lives in `~/.agents/kyro/current/manifest.json` (one refresh serves all projects). |
| **Team commit matrix** | Commit `project.json` + `scopes/**`. Do **not** commit `local.json` (personal `activeScope`). Install writes `.agents/kyro/.gitignore` for local-only files — you no longer need to gitignore the entire `.agents/kyro/` tree or treat monolito `kyro.json` as the only multi-dev strategy. |
| **Clone bootstrap** | From the clone root: `install --init-workspace --yes` writes layers if missing, **rehydrates** on-disk scopes into the shared registry, and leaves `activeScope` unset when multiple scopes exist. Then: `… scope set-active <scope> --yes`. |
| **Read-only commands** | `status` / `doctor` / `context-pack` never create project state files; they surface an install bootstrap remedy when layers are missing. |
| **Global bin (optional)** | `npm i -g kyro-ai@latest` for a durable `kyro` on PATH; still prefer `@latest` on every upgrade. |

Details: [Teams multi-dev contract](docs/teams.md) · [CLI project state](docs/cli.md).

---

## FAQ

**Do agents need to install separately, or does the plugin work for everyone?**

The plugin is global (installed once per machine). If you're solo, you're done after `/plugin install kyro-ai`. If your team shares a repo, also run `npx kyro-ai@latest install --init-workspace --yes` from the project root once — it writes `.agents/kyro/project.json` (committed) and `local.json` per dev (gitignored).

**How do I upgrade to the latest version?**

From the project root:

```bash
npx kyro-ai@latest sync --scope workspace --yes
```

Or if installed globally:

```bash
npm i -g kyro-ai@latest
kyro sync --scope workspace --yes
```

**Can agents hand-edit `sprint.json`?**

No. Kyro enforces schema and gates through CLI verbs, not prompt discipline. Use `kyro plan --from <file>`, `kyro record-evidence`, `kyro review`, and `kyro close-sprint` instead of hand-edits.

**My team has scopes already. How do I join?**

```bash
cd /path/to/your-project
npx kyro-ai@latest install --init-workspace --yes
```

Kyro registers existing scopes into `project.json` and creates your personal `local.json`. Then set your active scope:

```bash
kyro scope set-active <scope> --yes
```

**What if `.kyro` ends up in the wrong directory?**

Remove it and reinstall from the correct project root:

```bash
rm -rf ./.agents/kyro
cd /path/to/actual/project
npx kyro-ai@latest install --init-workspace --yes
```

**What's the difference between `/plugin install kyro-ai` and `npx kyro-ai@latest install`?**

- `/plugin install kyro-ai` — installs the Claude Code plugin (global, one-time)
- `npx kyro-ai@latest install` — initializes shared project state (`.agents/kyro/`). Only needed if your team shares the repo. Solo devs don't need to run this.

---

## Documentation

**Start here**

| Guide | When |
| ----- | ---- |
| [Getting started](docs/getting-started.md) | First install and first scope |
| [CLI](docs/cli.md) | Install, sync, doctor, tool-owned verbs, invocation |
| [Teams](docs/teams.md) | Multi-dev commit matrix, clone bootstrap, layered state |
| [Commands reference](docs/commands-reference.md) | Full `/kyro:*` semantics |
| [Agent adapters](docs/agent-adapters.md) | Host-specific setup |

**Go deeper**

| Guide | Topic |
| ----- | ----- |
| [Architecture](docs/architecture.md) | Layout and data flow |
| [Context management](docs/context-management.md) | Handoff and continuity |
| [Maker/checker](docs/maker-checker.md) | Evidence and review contract |
| [Spec traceability](docs/spec-traceability.md) | Requirements → scenarios → tasks |
| [Sprint-close checkpoints](docs/sprint-close-checkpoints.md) | Lossless close and recovery |
| [Cost model](docs/cost-model.md) | Token budgets |
| [MCP](docs/mcp.md) · [Trace](docs/trace.md) · [Evals](docs/evals.md) · [Guardrails](docs/guardrails.md) | Structured tools, audit, regression, policy |
| [Programmatic usage](docs/programmatic-usage.md) | Embedding instructions in custom apps |

---

## Development (contributors)

```bash
npm ci
npm run build
npm run check   # typecheck, versions, links, dist freshness, evals, …
npm pack --dry-run
```

`dist/` must stay in sync with `src/` (`npm run check:dist`). Releases: [release checklist](docs/release-checklist.md).

---

## Philosophy

1. **Commands over prose** — invoke a workflow; don’t re-paste a 2k-line prompt.
2. **One source of truth per scope** — `sprint.json`, not chat memory.
3. **CLI owns deterministic writes** — health can’t depend on prompt discipline.
4. **One sprint at a time** — adapt from evidence, retro, and debt.

---

<p align="center">
  <br/>
  <b>If Kyro helps your AI coding workflow, star the repo so other builders can find it.</b>
  <br/><br/>
  <a href="https://github.com/SynapSync/kyro-ai/stargazers"><img src="https://img.shields.io/github/stars/SynapSync/kyro-ai?style=for-the-badge&logo=github&color=D97757&labelColor=1e1e2e" alt="Stars"/></a>
  <br/><br/>
  <a href="https://github.com/SynapSync/kyro-ai/issues">Report Issues</a> &bull;
  <a href="https://synapsync.dev">SynapSync</a>
  <br/><br/>
  <sub>Built by <a href="https://github.com/SynapSync">SynapSync</a> — a practical harness for multi-agent software delivery.</sub>
</p>
