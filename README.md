<p align="center">
  <h1 align="center">Kyro</h1>
</p>

<p align="center">
  <a href="https://github.com/SynapSync/kyro-workflow/stargazers"><img src="https://img.shields.io/github/stars/SynapSync/kyro-workflow?style=for-the-badge&logo=github&color=D97757&labelColor=1e1e2e" alt="Stars"/></a>
  <a href="https://www.npmjs.com/package/@synapsync/kyro-workflow"><img src="https://img.shields.io/npm/v/@synapsync/kyro-workflow?style=for-the-badge&logo=npm&color=E8926F&labelColor=1e1e2e" alt="npm"/></a>
  <a href="https://github.com/SynapSync/kyro-workflow/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-22c55e?style=for-the-badge&labelColor=1e1e2e" alt="License"/></a>
  <a href="https://github.com/SynapSync/kyro-workflow/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/SynapSync/kyro-workflow/ci.yml?style=for-the-badge&logo=githubactions&logoColor=white&label=CI&labelColor=1e1e2e" alt="CI"/></a>
</p>

<p align="center">
  <b>Portable sprint workflow kit for AI coding agents.</b><br/>
  Markdown-first orchestration &bull; 1 orchestrator &bull; 3 workflow intents &bull; 2 reusable skills &bull; Provider-neutral by default
</p>

---

## What Is Kyro?

Kyro is an **agent-agnostic workflow kit** for iterative AI-assisted development. It gives any capable coding agent a shared operating model for analysis, sprint planning, implementation, review, context handoff, and learned rules.

Kyro is portable because its source of truth is plain markdown:

- **Orchestrator instructions** in `agents/orchestrator.md`
- **Reusable skills** in `skills/sprint-forge/` and `skills/qa-review/`
- **Workflow intents** in `commands/`
- **Project state** in `.agents/sprint-forge/{scope}/`

Claude Code has a native adapter through `.claude-plugin/`. Every other agent uses the same core files installed with one command.

---

## Install (One Command)

From any project directory (TypeScript, Python, Flutter, Go, etc.):

```bash
npx @synapsync/kyro-workflow init
```

Optional flags:

```bash
npx @synapsync/kyro-workflow init --cursor   # also install .cursor/rules/kyro-workflow.mdc
npx @synapsync/kyro-workflow doctor          # verify installation
```

`init` copies the orchestrator and skills, writes a stack-agnostic `config.json` (empty `quality_gates`), detects your harness, merges Kyro npm scripts, and records `.kyro/install.json` so bundled scripts resolve paths automatically.

After init, start a forge cycle in your agent:

```text
Use Kyro forge for <scope>.
Read .agents/orchestrator.md and .skills/sprint-forge/SKILL.md.
Persist artifacts under .agents/sprint-forge/<scope>/.
```

Add stack-specific commands to `config.json` → `quality_gates` when you are ready (for example `pytest`, `flutter analyze`, or `npm run typecheck`).

> **Note:** `npx skills add` installs skills only — it does not install the full Kyro workflow. Use `@synapsync/kyro-workflow init` instead.

---

## Core Workflow

```
[ANALYZE]  → investigate the project or scope
    ↓
[PLAN]     → generate or update roadmap and sprint tasks
    ↓
[EXECUTE]  → implement task by task with checkpoints
    ↓
[REVIEW]   → validate quality, architecture, debt, and docs
    ↓
[WRAP-UP]  → update retro, re-entry prompts, and learned rules
```

Kyro has three stable workflow intents:

| Intent | Native slash command | Manual equivalent |
|--------|----------------------|-------------------|
| `forge` | `/kyro-workflow:forge` | Analyze, plan, execute, review, and close the sprint |
| `status` | `/kyro-workflow:status` | Read project artifacts and report progress/debt |
| `wrap-up` | `/kyro-workflow:wrap-up` | Close the session and update re-entry context |

Platforms without slash commands should ask the agent to perform the matching manual equivalent while referencing the orchestrator and skill files.

---

## Integration Levels

| Level | Platforms | What Works | Notes |
|-------|-----------|------------|-------|
| CLI install | All agents | `npx @synapsync/kyro-workflow init` | Canonical path — works on any stack |
| Native adapter | Claude Code | Commands, agent, skills, and Claude plugin metadata | Alternative to `init`; `.claude-plugin/` is adapter packaging |
| Programmatic adapter | Any LLM API | Load markdown instructions into prompts/system messages | Provider integration is owned by the host application |

Kyro does not claim native integration for Codex, OpenCode, Cursor, or other agents unless a verified adapter exists. Compatibility comes from portable markdown files and stable artifact conventions.

---

## Claude Code Adapter (Optional)

Claude Code can use the same `npx @synapsync/kyro-workflow init` path **or** the native plugin:

```bash
/plugin marketplace add SynapSync/kyro-workflow
/plugin install kyro-workflow@kyro-workflow
```

Local development:

```bash
git clone https://github.com/SynapSync/kyro-workflow.git
cd kyro-workflow
npm install && npm run build
claude --plugin-dir /path/to/kyro-workflow
```

The Claude adapter lives in `.claude-plugin/`. Core Kyro behavior remains in markdown assets shared by all agents.

---

## Advanced: Manual File Copy

If you cannot use npm in the target project, copy core files manually. See [Getting Started](docs/getting-started.md#advanced-manual-installation).

---

## Architecture

```
User intent
  └── Orchestrator instructions
        ├── sprint-forge skill
        ├── qa-review skill
        └── markdown project artifacts
```

```
kyro-workflow/
├── agents/
│   └── orchestrator.md
├── commands/
│   ├── forge.md
│   ├── status.md
│   └── wrap-up.md
├── skills/
│   ├── sprint-forge/
│   └── qa-review/
├── docs/
├── rules/
├── templates/
├── config.json
├── adapters/             # Harness templates (Cursor, generic, Kilo Code)
└── .claude-plugin/       # Claude Code adapter only
```

---

## Project Artifacts

Kyro persists workflow state in markdown artifacts:

```
.agents/sprint-forge/
├── rules.md
└── {scope}/
    ├── README.md
    ├── ROADMAP.md
    ├── RE-ENTRY-PROMPTS.md
    ├── findings/
    ├── sprints/
    └── handoffs/
```

This is the stable public interface. Any agent can inspect, modify, diff, and continue from these files.

---

## Configuration

`config.json` is intentionally small:

```json
{
  "rules": { "path": ".agents/sprint-forge/rules.md", "auto_load": true },
  "quality_gates": {},
  "harness": { "id": "auto", "enforcement": "manual" },
  "sprint": { "checkpoint_per_phase": true, "require_retro": true, "debt_aged_threshold_sprints": 3 }
}
```

Fresh installs ship with empty `quality_gates` so non-Node stacks are not forced into `npm run typecheck`. Add your stack commands when ready.

Kyro does not enforce model selection. Use the strongest available model for implementation and debugging. Lighter models are acceptable for read-only analysis, status reporting, or documentation review.

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/getting-started.md) | Quick start walkthrough |
| [Agent Adapters](docs/agent-adapters.md) | Harness matrix: generic, Cursor, Codex, OpenCode, Kilo Code, Claude Code |
| [Harness Templates](adapters/README.md) | Copy-and-customize adapter files per platform |
| [HOW-TO-USE-CURSOR](docs/HOW-TO-USE-CURSOR.md) | Cursor setup and prompts |
| [HOW-TO-USE-KILO-CODE](docs/HOW-TO-USE-KILO-CODE.md) | Kilo Code setup and prompts |
| [Commands Reference](docs/commands-reference.md) | Workflow intents and command semantics |
| [Agents Reference](docs/agents-reference.md) | Orchestrator protocols and checkpoints |
| [Rules Guide](docs/rules-guide.md) | Learned rules system |
| [Architecture](docs/architecture.md) | System architecture |
| [Programmatic Usage](docs/programmatic-usage.md) | Provider-neutral API integration pattern |
| [Context Management](docs/context-management.md) | Token limits, compaction, and re-entry strategy |

---

## Philosophy

1. **Markdown is the interface** — portability comes from files, not a runtime service.
2. **Investigate before planning** — analysis gates prevent shallow sprint plans.
3. **One sprint at a time** — each sprint adapts from the previous retro and debt.
4. **Checkpoints protect continuity** — progress must survive agent/session changes.
5. **Debt never disappears** — debt changes status only when explicitly resolved.
6. **The plan serves execution** — roadmaps adapt to reality.

---

<p align="center">
  <br/>
  <b>If you find this useful, star the repo to help others discover it.</b>
  <br/><br/>
  <a href="https://github.com/SynapSync/kyro-workflow/stargazers"><img src="https://img.shields.io/github/stars/SynapSync/kyro-workflow?style=for-the-badge&logo=github&color=D97757&labelColor=1e1e2e" alt="Stars"/></a>
  <br/><br/>
  <a href="https://github.com/SynapSync/kyro-workflow/issues">Report Issues</a> &bull;
  <a href="https://synapsync.dev">SynapSync</a> &bull;
  <a href="https://github.com/SynapSync/skills-registry">Skills Registry</a>
  <br/><br/>
  <sub>Built by <a href="https://github.com/SynapSync">SynapSync</a> — portable sprint workflow for AI coding agents.</sub>
</p>
