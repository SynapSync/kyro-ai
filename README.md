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
  <b>Multi-agent sprint harness for AI coding agents.</b><br/>
  One install command &bull; portable markdown core &bull; command skills &bull; project-local state &bull; agent adapters
</p>

---

## What Kyro AI Does

Kyro AI installs a project-local workflow harness that helps AI coding agents analyze, plan, execute, review, and close software work through repeatable sprint cycles.

It is designed for teams that switch between agents and do not want every agent to relearn the workflow from a giant prompt.

Kyro gives agents:

- a **managed core** with orchestrator, command, skill, and template instructions
- **command-like skills** such as `kyro-forge`, `kyro-status`, and `kyro-wrap-up`
- **workspace state** that tracks installed adapters and future scopes
- **human-readable artifacts** for roadmaps, phase documents, debt, retros, and re-entry context
- **doctor/sync/uninstall commands** so setup can be validated instead of guessed

---

## Quick Start

Install Kyro AI into the current project:

```bash
npx kyro-ai install --agent opencode,codex --scope workspace --yes
npx kyro-ai doctor
```

Use one agent only if needed:

```bash
npx kyro-ai install --agent opencode --scope workspace --yes
npx kyro-ai install --agent codex --scope workspace --yes
```

After install, open your agent and invoke the installed Kyro command skill:

```text
kyro-forge auth-refactor
```

Other installed command skills:

```text
kyro-status
kyro-wrap-up
```

If the host exposes slash commands, the equivalent public command namespace is:

```text
/kyro:forge
/kyro:status
/kyro:wrap-up
```

---

## Installed Layout

Kyro separates global runtime from project state. Runtime files live in your user-level agents directory; project files keep only state and artifacts.

Global runtime:

```text
~/.agents/
├── kyro/
│   ├── versions/
│   │   └── {version}/
│   │       ├── core/
│   │       │   ├── agents/
│   │       │   ├── config.json
│   │       │   └── WORKFLOW.yaml
│   │       ├── commands/
│   │       ├── skills/
│   │       │   ├── sprint-forge/
│   │       │   └── qa-review/
│   │       ├── KYRO.md
│   │       └── manifest.json
│   └── current -> versions/{version}
└── skills/
    ├── kyro-forge/SKILL.md
    ├── kyro-status/SKILL.md
    └── kyro-wrap-up/SKILL.md
```

Project state and artifacts:

```text
<project>/
└── .agents/
    └── kyro/
        ├── kyro.json
        └── scopes/
            └── {scope}/
                ├── state.json
                ├── ROADMAP.md
                └── phases/
```

Important invariant: `kyro install` creates the root project state at `.agents/kyro/kyro.json`. It does **not** create `.agents/kyro/scopes/{scope}/state.json`; scoped state belongs to future scope/forge creation.

## Who Invokes Whom

```text
User
  ↓
kyro / kyro-ai CLI
  ↓
installs managed core + adapter projections
  ↓
agent opens the project
  ↓
agent discovers AGENTS.md and/or ~/.agents/skills
  ↓
user invokes kyro-forge / kyro-status / kyro-wrap-up
  ↓
projected skill reads ~/.agents/kyro/current/commands/*.md
  ↓
orchestrator reads ~/.agents/kyro/current/core/agents/orchestrator.md
  ↓
sprint-forge skill assets guide the workflow
  ↓
artifacts are written under <project>/.agents/kyro/scopes/{scope}/
```

The user should not have to explain the workflow in natural language. If an agent cannot discover the installed command skills, that agent needs a better adapter.

---

## CLI Reference

Kyro AI exposes two equivalent bins:

```bash
kyro
kyro-ai
```

Commands:

| Command          | Purpose                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `kyro`           | Open the basic interactive configuration TUI                       |
| `kyro install`   | Install managed core and selected agent adapters                   |
| `kyro doctor`    | Validate package health, workspace state, core files, and adapters |
| `kyro sync`      | Refresh managed assets without rewriting unmanaged files           |
| `kyro uninstall` | Remove managed workspace assets                                    |

Common usage:

```bash
kyro install --agent opencode,codex --scope workspace --yes
kyro doctor --tokens --artifacts
kyro sync --agent codex --dry-run
kyro uninstall --dry-run
```

Supported install adapters today:

| Adapter    | Status                            | What it installs                                                      |
| ---------- | --------------------------------- | --------------------------------------------------------------------- |
| `opencode` | Implemented                       | `~/.agents/skills/kyro-*` command skill projections                     |
| `codex`    | Implemented                       | `~/.agents/skills/kyro-*` plus a managed Kyro block in root `AGENTS.md` |
| `claude`   | Planned for CLI workspace install | Claude plugin remains first-class through `.claude-plugin/`           |
| `cursor`   | Planned                           | Not installed by the CLI yet                                          |

There is intentionally no `generic` adapter. Cross-agent instructions belong in root `AGENTS.md`; install adapters should target concrete agent capabilities.

---


## Artifact Integrity

Kyro treats the repo as the system of record. Validate and repair the knowledge contract with:

```bash
kyro doctor --artifacts
kyro repair --kyro-scope <scope> --yes
kyro scope inspect <scope>
```

`repair` only rebuilds JSON routing/summaries from existing Markdown evidence; it does not rewrite user-authored Markdown.

## Core Workflow

Kyro has three stable workflow intents:

| Intent  | Skill / command                  | What it does                                                    |
| ------- | -------------------------------- | --------------------------------------------------------------- |
| Forge   | `kyro-forge` / `/kyro:forge`     | Analyze, plan, execute, review, and close a sprint cycle        |
| Status  | `kyro-status` / `/kyro:status`   | Report project progress, roadmap health, and technical debt     |
| Wrap-up | `kyro-wrap-up` / `/kyro:wrap-up` | Close a session, update handoff context, and preserve learnings |

Forge is routed progressively:

```text
read kyro.json/state.json/index.json
  → choose INIT, plan, execute, review, close, or recover
  → load only the selected mode/helper/template
  → update Markdown evidence plus JSON summaries
```

Kyro is intentionally sprint-by-sprint and summary-first. It should not pre-load every roadmap, sprint, helper, and template just to decide the next action.

---

## Architecture

The source package is organized around portable markdown instructions plus a small deterministic CLI:

```text
kyro-ai/
├── src/cli/                 # installer, doctor, sync, uninstall, adapters
├── agents/                  # orchestrator instruction
├── commands/                # forge, status, wrap-up command definitions
├── skills/
│   ├── sprint-forge/        # main workflow skill and assets
│   └── qa-review/           # senior QA review skill
├── docs/                    # architecture, CLI, adapter, and command docs
├── rules/                   # reusable operating rules
├── templates/               # context templates
├── .claude-plugin/          # Claude plugin adapter packaging
├── WORKFLOW.yaml
└── config.json
```

Runtime contract:

| Layer           | Responsibility                                                                |
| --------------- | ----------------------------------------------------------------------------- |
| CLI             | Install, sync, uninstall, validate, and project managed files                 |
| Adapter         | Translate Kyro into each agent's native/compatible instruction surface        |
| Projected skill | Give the agent a short command entrypoint without duplicating lifecycle prose |
| Orchestrator    | Coordinate phases, gates, review, debugging, and handoff                      |
| Sprint Forge skill | Define workflow modes, helpers, templates, and discipline rules |
| Artifacts       | Persist roadmap, phases, debt, retros, and re-entry context in markdown       |

---

## Claude Plugin Support

Claude remains first-class.

The Claude plugin adapter lives in `.claude-plugin/` and is shipped with the package. The CLI workspace installer does not replace the Claude plugin; it complements it for agents that need workspace-local command skills and `AGENTS.md` instructions.

Claude plugin install:

```bash
/plugin marketplace add SynapSync/kyro-ai
/plugin install kyro-ai@kyro-ai
```

Local plugin development:

```bash
git clone https://github.com/SynapSync/kyro-ai.git
cd kyro-ai
npm install
npm run build
claude --plugin-dir /path/to/kyro-ai
```

---

## Development

Requirements:

- Node.js 18+
- npm

Useful commands:

```bash
npm ci
npm run check
npm run build
npm pack --dry-run
```

`npm run check` runs:

- TypeScript typecheck
- package/plugin/workflow version validation
- relative markdown link validation

Release tags publish to npm through GitHub Actions when the tag matches `package.json.version`:

```bash
git tag v3.2.2
git push origin v3.2.2
```

The release workflow expects the repository secret `NPM_TOKEN`.

---

## Documentation

| Guide                                            | Description                                              |
| ------------------------------------------------ | -------------------------------------------------------- |
| [CLI](docs/cli.md)                               | Installer, doctor, sync, uninstall, and adapter commands |
| [Commands Reference](docs/commands-reference.md) | `/kyro:*` command semantics                              |
| [Architecture](docs/architecture.md)             | System architecture and data flow                        |
| [Agent Adapters](docs/agent-adapters.md)         | Adapter setup and host-specific notes                    |
| [Harness Migration](docs/harness-migration.md)   | Direction for the multi-agent runtime                    |
| [Getting Started](docs/getting-started.md)       | Introductory workflow guide                              |
| [Rules Guide](docs/rules-guide.md)               | Persistent learning rules                                |
| [Context Management](docs/context-management.md) | Re-entry prompts and continuity strategy                 |
| [Programmatic Usage](docs/programmatic-usage.md) | Using Kyro instructions from custom LLM apps             |

---

## Philosophy

1. **Commands over prose** — users should invoke workflows, not explain them repeatedly.
2. **Markdown remains the collaboration layer** — humans and agents can inspect the same artifacts.
3. **The CLI owns deterministic checks** — package health should not depend on prompt discipline.
4. **Adapters are concrete** — each supported agent gets the files it actually knows how to use.
5. **One sprint at a time** — each cycle adapts from evidence, retro, and technical debt.
6. **Claude stays first-class** — multi-agent support does not mean retiring the Claude plugin.

---

<p align="center">
  <br/>
  <b>If this helps your AI coding workflow, star the repo so other builders can find it.</b>
  <br/><br/>
  <a href="https://github.com/SynapSync/kyro-ai/stargazers"><img src="https://img.shields.io/github/stars/SynapSync/kyro-ai?style=for-the-badge&logo=github&color=D97757&labelColor=1e1e2e" alt="Stars"/></a>
  <br/><br/>
  <a href="https://github.com/SynapSync/kyro-ai/issues">Report Issues</a> &bull;
  <a href="https://synapsync.dev">SynapSync</a>
  <br/><br/>
  <sub>Built by <a href="https://github.com/SynapSync">SynapSync</a> — a practical harness for multi-agent software delivery.</sub>
</p>
