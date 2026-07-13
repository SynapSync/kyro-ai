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
  <b>The sprint workflow your AI coding agents share — install once, every agent picks it up.</b><br/>
  One install command &bull; portable markdown core &bull; command skills &bull; project-local state &bull; agent adapters
</p>

---

## The problem

You use more than one AI coding agent. Claude one day, Cursor the next, Codex or OpenCode when it fits. And every single one starts from zero:

- You **re-explain your workflow** in a 2,000-line prompt, or paste it again, and again.
- Between sessions the agent **forgets where it was** — which sprint, what's done, what's blocked.
- "Quality" is whatever the model felt like doing that run. **No real gate** stops a half-finished task from being called done.

Kyro fixes this. You install one project-local harness, and any agent that opens the project runs the **same** sprint workflow against the **same** source of truth — with deterministic checks enforced in code, not in prompt goodwill.

---

## See it work

A full cycle is one command. The agent routes itself through the phases and stops at each gate for your call:

```text
you ›  /kyro:forge add JWT auth to the API

kyro ›  INIT      analyzed the module, wrote objective + success criteria
        ─ gate ─  proceed / adjust / cancel?         ← you decide
        PLAN      broke the work into a 6-task sprint
        ─ gate ─  proceed / adjust / cancel?
        EXECUTE   task 1/6 … evidence recorded on the task
        REVIEW    tool-owned check, not self-grading
        CLOSE     lossless scope checkpoint archived, learnings kept

state ›  .agents/kyro/scopes/jwt-auth/sprint.json      ← single source of truth
```

Everything the agent knows about that work — objective, roadmap, the active sprint, technical debt, conventions, and where to resume — lives in **one** `sprint.json`. Close a session with `/kyro:wrap-up`, come back tomorrow (or from a different agent), and it picks up exactly where it left off.

---

## What you get

Under the hood, one install gives your agents:

- a **managed core** with orchestrator, command, skill, and template instructions
- **command-like skills** such as `kyro-forge`, `kyro-status`, `kyro-qa`, and `kyro-wrap-up`
- **a single source of truth per scope** — one `sprint.json` holding objective, success criteria, roadmap, the active sprint, debt, conventions, and handoff routing
- **lossless scope checkpoints** — every close preserves complete scope state before and after the transition, while retaining the legacy verbatim ActiveSprint snapshot
- **deterministic CLI gates** (`doctor`, `analyze`) so quality is enforced in code, not left to prompt discipline
- **behavioral evals** (`kyro eval`) that replay agent-facing routing, guardrails, and artifact transitions
- **typed MCP tools** (`kyro mcp serve`) for hosts that prefer structured tool calls over CLI text
- **append-only trace events** (`kyro trace`) for audit/debugging without becoming a source of truth
- **portable guardrails** for dangerous operations across CLI and MCP surfaces

---

## Quick Start

```bash
npx kyro-ai install --agent opencode,codex --scope workspace --yes
npx kyro-ai doctor
```

Then open your agent and start a cycle:

```text
/kyro:forge add JWT auth to the API
```

That's it. No prompt to paste, no workflow to explain.

> **On Claude?** Kyro ships as a first-class plugin — see [Claude plugin](#claude-plugin) below.

---

## The commands

Six slash commands, one job each. All are thin routers over `sprint.json` — they read structured state first, then load only what the current step needs.

| Command             | What it does                                                                 |
| ------------------- | ---------------------------------------------------------------------------- |
| `/kyro:forge`       | Full cycle: analyze → plan → execute → review → close, with a gate per phase  |
| `/kyro:status`      | Progress bars, roadmap health, and technical-debt summary (`brief`/`full`/`debt`) |
| `/kyro:wrap-up`     | Close the session, refresh handoff routing, preserve learnings               |
| `/kyro:idea`        | **Optional** pre-scope step: mature a rough or developed idea into an evidence-grounded, execution-ready plan |
| `/kyro:qa`          | **Independent certification audit**: validate scope implementation, architecture, security, testing, and planning against spec |
| `/kyro:task-context`| Emit a copy-paste prompt to continue the work in a fresh context             |

On hosts without slash commands, the CLI projects the equivalent skills `kyro-forge`, `kyro-status`, `kyro-wrap-up`, `kyro-task-context`, `kyro-idea`, and `kyro-qa` into `~/.agents/skills/`.

---

## How it works

Kyro is deliberately **one sprint at a time** and **single-source**. `/kyro:forge` never guesses the next move — it derives it from state:

```text
read kyro.json + scopes/{scope}/sprint.json
  → route on sprint.json.handoff.nextAction
    (init → clarify → plan → execute → review → close, or recover)
  → load only the selected mode/helper/template
  → one safe write back to sprint.json
```

It loads two files to start and updates one per action — it never pre-loads every roadmap, helper, and template just to decide what's next. Unknowns become explicit `[NEEDS CLARIFICATION]` markers resolved before planning: the agent admits what it doesn't know instead of inventing it.

---

## Adapters

The CLI installs the harness into concrete agents. There is intentionally no `generic` adapter — cross-agent instructions belong in root `AGENTS.md`.

| Adapter    | Status                            | What it installs                                                       |
| ---------- | --------------------------------- | ---------------------------------------------------------------------- |
| `opencode` | Implemented                       | `~/.agents/skills/kyro-*` command-skill projections                     |
| `codex`    | Implemented                       | `~/.agents/skills/kyro-*` plus a managed Kyro block in root `AGENTS.md` |
| `claude`   | First-class via plugin            | Ships in `.claude-plugin/`; CLI workspace install planned              |
| `cursor`   | Planned                           | Not installed by the CLI yet                                           |

See [Agent Adapters](docs/agent-adapters.md) for host-specific setup.

---

## Claude plugin

Claude gets the full workflow as a native plugin:

```bash
/plugin marketplace add SynapSync/kyro-ai
/plugin install kyro-ai@kyro-ai
```

Local plugin development:

```bash
git clone https://github.com/SynapSync/kyro-ai.git
cd kyro-ai && npm install && npm run build
claude --plugin-dir /path/to/kyro-ai
```

---

## Documentation

The README is the 30-second tour. Everything deep lives in `docs/`:

| Guide                                            | Description                                              |
| ------------------------------------------------ | -------------------------------------------------------- |
| [Getting Started](docs/getting-started.md)       | Introductory workflow guide                              |
| [Commands Reference](docs/commands-reference.md) | Full `/kyro:*` command semantics                         |
| [CLI](docs/cli.md)                               | Installer, doctor, analyze, sync, uninstall, adapters    |
| [Architecture](docs/architecture.md)             | System architecture, layout, and data flow               |
| [Agent Adapters](docs/agent-adapters.md)         | Adapter setup and host-specific notes                    |
| [Context Management](docs/context-management.md) | Handoff routing and cross-session continuity             |
| [Cost Model](docs/cost-model.md)                 | Lean runtime loading and token budgets                   |
| [Behavioral Evals](docs/evals.md)               | Deterministic regression eval harness                    |
| [MCP Typed Tools](docs/mcp.md)                   | MCP server/tool contracts for agent hosts                |
| [Trace Events](docs/trace.md)                    | Append-only runtime audit trace                          |
| [Sprint-close Checkpoints](docs/sprint-close-checkpoints.md) | Lossless archive and recovery contract          |
| [Portable Guardrails](docs/guardrails.md)        | Policy enforcement across CLI and MCP surfaces           |
| [Maker/Checker Boundary](docs/maker-checker.md)  | Tool-owned task review and evidence/verdict contracts    |
| [Spec Traceability](docs/spec-traceability.md)   | Requirement → Scenario → Task traceability               |
| [Rules Guide](docs/rules-guide.md)               | Persistent learning rules                                |
| [Programmatic Usage](docs/programmatic-usage.md) | Using Kyro instructions from custom LLM apps             |
| [Release Checklist](docs/release-checklist.md)   | Maintainer release and CI gate ordering                  |

---

## Development

```bash
npm ci
npm run check   # typecheck, version sync, links, dist freshness, evals, guardrails
npm run build
npm pack --dry-run
```

`dist/` is generated from `src/` and must stay in sync — `npm run check:dist` proves the committed build matches source, so releases can't ship stale output. Release tags matching `package.json.version` publish to npm via GitHub Actions (requires the `NPM_TOKEN` secret).

---

## Philosophy

1. **Commands over prose** — invoke a workflow, don't re-explain it every time.
2. **Markdown is the collaboration layer** — humans and agents inspect the same artifacts.
3. **The CLI owns deterministic checks** — health can't depend on prompt discipline.
4. **Adapters are concrete** — each agent gets files it actually knows how to use.
5. **One sprint at a time** — each cycle adapts from evidence, retro, and debt.
6. **Claude stays first-class** — multi-agent support never retires the plugin.

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
