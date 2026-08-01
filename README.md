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

## Why Kyro

AI agents forget context, invent process, and edit planning files by hand. Across Claude, Codex, OpenCode, and others you re-explain the same workflow every session.

Kyro installs a **project harness** so any agent that opens the repo:

- follows the **same** sprint cycle (init → plan → execute → review → close)
- reads and writes **one** scope file: `.agents/kyro/scopes/{scope}/sprint.json`
- mutates state through **CLI verbs** (schema + gates enforced in code, not prompt goodwill)

---

## Quick start

**Prerequisites:** Node.js ≥ 18, Git, and an agent that can load skills, slash commands, or root `AGENTS.md`.

### 1. Install from your project root

**Always `cd` into the repo you want Kyro to manage, then run install.**  
Runtime and skills go under your home directory; project state (`.agents/kyro/`) is created in the **current working directory**. Running install from `~`, `/tmp`, or another folder still installs the global pieces but initializes Kyro state in the wrong place.

Always use **`kyro-ai@latest`** so install/sync pulls the current release (plain `npx kyro-ai` can reuse a stale cache).

```bash
cd /path/to/your-app

# Default (standard skills under ~/.agents/skills/kyro-*)
# --init-workspace writes layered project state here (project.json + local.json),
# ensures .agents/kyro/.gitignore for local-only files, and rehydrates existing scopes/ after clone
npx kyro-ai@latest install --scope workspace --init-workspace --yes

# Optional host adapters (can combine; still run from the project root)
npx kyro-ai@latest install --agent codex --scope workspace --init-workspace --yes
npx kyro-ai@latest install --agent opencode --scope workspace --init-workspace --yes
```

| Layer | Location | Depends on `cd`? |
| ----- | -------- | ---------------- |
| Runtime + CLI | `~/.agents/kyro/current/` | No |
| Command skills | `~/.agents/skills/kyro-*` | No |
| Project state | `./.agents/kyro/` (cwd) | **Yes** |

If the repo already has `.agents/kyro/scopes/` (team clone) without local state, the same command registers those scopes into shared `project.json` and writes your personal `local.json`. With several scopes, set yours afterward: `… scope set-active <scope> --yes`.

### 2. Verify

```bash
# Preferred after a plain npx install (no global bin required):
node ~/.agents/kyro/current/dist/cli.js doctor

# Or, if you have a durable global install:
#   npm i -g kyro-ai && kyro doctor
npx kyro-ai@latest doctor
```

> **`npx` vs bare `kyro`:** `npx kyro-ai@latest install` does **not** permanently put `kyro` on your PATH. Install/sync persists a runnable invocation (often `node ~/.agents/kyro/current/dist/cli.js`) on the **global** runtime manifest and projected modes — not on project state files. Agents should use **that** form — not invent hand-edits when `kyro` is missing. Details: [CLI invocation](docs/cli.md#cli-invocation-persistence-kyroinvocation).

### 3. Run a cycle

In Claude-style hosts:

```text
/kyro:forge add JWT auth to the API
```

On hosts that discover skills:

```text
kyro-forge add JWT auth to the API
```

```text
you ›  /kyro:forge add JWT auth to the API

kyro ›  INIT      objective + success criteria
        ─ gate ─  proceed / adjust / cancel?
        PLAN      sprint tasks
        ─ gate ─  proceed / adjust / cancel?
        EXECUTE   evidence via CLI (not hand JSON)
        REVIEW    checker verdict via CLI
        CLOSE     lossless checkpoint + ledger

state ›  .agents/kyro/scopes/{scope}/sprint.json
```

---

## Choose your host

| Host | How to install | How to invoke |
| ---- | -------------- | ------------- |
| **Claude Code** | Plugin (recommended): `/plugin marketplace add SynapSync/kyro-ai` then `/plugin install kyro-ai@kyro-ai`. Optional: from the **project root**, `npx kyro-ai@latest install --init-workspace --yes` for shared runtime/state. | `/kyro:forge`, `/kyro:status`, … |
| **Codex** | From project root: `npx kyro-ai@latest install --agent codex --init-workspace --yes` | Skills `kyro-*` + managed block in root `AGENTS.md` |
| **OpenCode** | From project root: `npx kyro-ai@latest install --agent opencode --init-workspace --yes` | Native `/kyro/*` commands or `~/.config/opencode/skills/kyro-*` |
| **Other / Cursor** | From project root: `npx kyro-ai@latest install --init-workspace --yes` (standard skills). Cursor-specific adapter is not shipped yet. | `kyro-forge`, `kyro-status`, … under `~/.agents/skills/` |

Host notes: [Agent adapters](docs/agent-adapters.md) · [Codex](docs/HOW-TO-USE-CODEX.md) · [OpenCode](docs/HOW-TO-USE-OPENCODE.md)

### Claude plugin (local dev)

```bash
git clone https://github.com/SynapSync/kyro-ai.git
cd kyro-ai && npm install && npm run build
claude --plugin-dir /path/to/kyro-ai
```

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

## Troubleshooting

| Symptom | What to do |
| ------- | ---------- |
| `kyro: command not found` | Expected after install-only-via-npx. Use `node ~/.agents/kyro/current/dist/cli.js …`, or `npm i -g kyro-ai@latest`, then from the project root `npx kyro-ai@latest sync --yes`. |
| Agent hand-writes `sprint.json` | Stop. Fix CLI discovery, load **kyro-ai** skills (`kyro-forge`), run `… doctor --artifacts`. Prefer `plan --from` / tool-owned verbs. |
| No `.agents/kyro/` in the repo / wrong folder has Kyro state | Install was run outside the project. Remove stray `./.agents/kyro` if you created it by mistake, `cd` to the real project root, re-run `install --init-workspace --yes`. |
| Status/doctor says install bootstrap / missing project state | From project root: `npx kyro-ai@latest install --init-workspace --yes` (creates `project.json` + `local.json`; does not invent scopes). |
| Stale runtime after upgrade | From project root: `npx kyro-ai@latest sync --scope workspace --yes` |
| Broken close / checkpoint | Do not null `activeSprint` by hand. Use `close-sprint` and [sprint-close checkpoints](docs/sprint-close-checkpoints.md). |

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
