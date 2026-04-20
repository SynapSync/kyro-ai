<p align="center">
  <h1 align="center">Kyro</h1>
</p>

<p align="center">
  <a href="https://github.com/SynapSync/kyro-workflow/stargazers"><img src="https://img.shields.io/github/stars/SynapSync/kyro-workflow?style=for-the-badge&logo=github&color=D97757&labelColor=1e1e2e" alt="Stars"/></a>
  <a href="https://www.npmjs.com/package/kyro-workflow"><img src="https://img.shields.io/npm/v/kyro-workflow?style=for-the-badge&logo=npm&color=E8926F&labelColor=1e1e2e" alt="npm"/></a>
  <a href="https://github.com/SynapSync/kyro-workflow/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-22c55e?style=for-the-badge&labelColor=1e1e2e" alt="License"/></a>
  <a href="https://github.com/SynapSync/kyro-workflow/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/SynapSync/kyro-workflow/ci.yml?style=for-the-badge&logo=githubactions&logoColor=white&label=CI&labelColor=1e1e2e" alt="CI"/></a>
</p>

<p align="center">
  <b>Complete sprint workflow system for AI-assisted development.</b><br/>
  2 agents &bull; 3 commands &bull; 1 skill &bull; 10 guardian events (configurable) &bull; Adaptive per-project learning<br/>
  Built for <b>Claude Code</b>. Compatible with any AI coding agent via SkillKit.
</p>

---

## What Is Kyro?

Kyro is a **workflow** that orchestrates iterative project execution through the orchestrator agent, guardian agent, and persistent learning. It evolves from the [sprint-forge skill](https://github.com/SynapSync/skills-registry) into a full Command > Agent > Skill architecture.

Unlike rigid project planners, Kyro:

- **Analyzes first** — deep codebase exploration before committing to a plan
- **Generates sprints one at a time** — each sprint feeds from the previous one's retro
- **Learns across sprints** — corrections become persistent rules in `.agents/sprint-forge/rules.md`
- **Validates at every step** — BLOCKER/WARNING/SUGGESTION checklist per task
- **Adapts the roadmap** — the plan evolves based on what execution reveals
- **Persists context** — re-entry prompts + enriched handoffs with mental model

---

## What's New in v3.0

<table>
<tr><td><b>2 Agents</b></td><td>Orchestrator (full cycle coordination) + Guardian (configurable event-based checkpoints)</td></tr>
<tr><td><b>3 Commands</b></td><td><code>/kyro-workflow:forge</code>, <code>/kyro-workflow:status</code>, <code>/kyro-workflow:wrap-up</code></td></tr>
<tr><td><b>10 Guardian Events</b></td><td>configurable checkpoints replacing Node.js hooks/scripts with intelligent, context-aware validation</td></tr>
<tr><td><b>Per-Project Learning</b></td><td>Corrections become rules in <code>.agents/sprint-forge/rules.md</code> — applied automatically in future sprints</td></tr>
<tr><td><b>Validation Gates</b></td><td>BLOCKER/WARNING/SUGGESTION checklist per task, phase gates with user approval</td></tr>
<tr><td><b>Velocity Metrics</b></td><td>Sprint velocity trends, debt heatmap, underestimation pattern detection</td></tr>
<tr><td><b>Enriched Handoffs</b></td><td>Mental context: active hypotheses, pending decisions, blockers, next action</td></tr>
<tr><td><b>SQLite + FTS5</b></td><td>Searchable learnings, session stats, and debt tracking database</td></tr>
</table>

---

## How It Works

### The `/kyro-workflow:forge` Cycle

```
[PHASE 1: ANALYZE]  → Analysis phase investigates codebase (read-only)
        ↓
   GATE 1: User approves analysis
        ↓
[PHASE 2: PLAN]     → Generate sprint with phases, tasks, and estimates
        ↓
   GATE 2: User approves sprint plan
        ↓
[PHASE 3: IMPLEMENT] → Execute task by task
   ├── After each task → Review step validates (BLOCKER/WARNING/SUGGESTION)
   ├── On failure     → Debug protocol investigates root cause
   └── Checkpoint after each phase
        ↓
   GATE 3: User approves implementation
        ↓
[PHASE 4: REVIEW]   → Full sprint review + retro
        ↓
[PHASE 5: CLOSE]    → Debt update, re-entry prompts, rule proposals
```

Every gate requires explicit user approval. The plan serves execution, not the reverse.

### The Self-Correction Loop

```
User corrects agent → Agent proposes rule → User approves
        ↓
Rule saved to .agents/sprint-forge/rules.md
        ↓
Future sessions load rules automatically
        ↓
Same mistake never happens again
```

Rules are specific, dated, and tied to the project where they were learned. After enough sprints, the agent barely needs correcting.

---

## Architecture

```
Command (user entry point)
  └── Agent (orchestrator — full cycle coordination)
        ├── Skill (domain knowledge, injected at startup)
        └── Agent (guardian — configurable event-based checkpoints)
```

```
kyro-workflow/
├── agents/                     # 2 agents
│   ├── orchestrator.md         # Full cycle coordinator — analysis, review, debugging, and sprint execution
│   └── guardian.md             # Event-based checkpoints — configurable lifecycle events (rules loading, drift detection, quality checks)
│
├── commands/                   # 3 slash commands
│   ├── forge.md                # /kyro-workflow:forge — full cycle with gates
│   ├── status.md               # /kyro-workflow:status — metrics + debt heatmap
│   └── wrap-up.md              # /kyro-workflow:wrap-up — session closure ritual
│
├── skills/                     # 1 skill (domain knowledge)
│   └── sprint-forge/            # Core orchestration and sprint execution
│       ├── SKILL.md
│       └── assets/             # Modes, helpers (analyzer, reviewer, learner, metrics, handoff), templates
│
├── docs/                       # 8 documentation guides
│   ├── getting-started.md      # Quick start walkthrough
│   ├── commands-reference.md   # Full command documentation
│   ├── agents-reference.md     # Agent capabilities and tools
│   ├── rules-guide.md          # Self-correction rules system
│   ├── architecture.md         # System architecture deep dive
│   ├── model-selection.md      # Model tier selection guide
│   ├── context-management.md   # Token limits and compaction strategies
│   └── (+ additional guides)   # Coverage for all major workflows
│
├── src/                        # TypeScript source (SQLite + FTS5)
│   ├── db/                     # Database init, schema, store
│   └── search/                 # Full-text search with BM25 ranking
│
├── .claude-plugin/                # Plugin packaging for Claude Code
│   ├── plugin.json                # Plugin manifest (version must match package.json)
│   ├── marketplace.json           # Marketplace listing metadata
│   ├── settings.json              # Default permissions
│   └── README.md                  # Installation instructions
│
├── .github/workflows/          # CI/CD pipelines
│   ├── ci.yml                  # Build + test on push/PR
│   └── release.yml             # GitHub release on tag push
│
├── WORKFLOW.yaml               # Workflow definition (version must match package.json)
├── config.json                 # Workflow configuration
├── settings.example.json       # Production settings template
└── CLAUDE.md                   # Development instructions
```

---

## Installation

### Option 1: Claude Code Plugin (Recommended)

From inside a Claude Code session, run:

```bash
# Step 1 — Register the marketplace
/plugin marketplace add SynapSync/kyro-workflow

# Step 2 — Install the plugin
/plugin install kyro-workflow@kyro-workflow
```

That's it. All commands, agents, and skills are available immediately.

### Option 2: Claude Code CLI

```bash
# Register marketplace and install from your terminal
claude plugin install kyro-workflow@SynapSync/kyro-workflow
```

### Option 3: Local Development

If you want to hack on Kyro itself or test changes before publishing:

```bash
# Clone the repo
git clone https://github.com/SynapSync/kyro-workflow.git
cd kyro-workflow

# Install dependencies and build the database layer
npm install && npm run build

# Option A — Load for a single session
claude --plugin-dir /path/to/kyro-workflow

# Option B — Install permanently from local path
claude plugin install /path/to/kyro-workflow
```

### Option 4: npm

```bash
npm install -g kyro-workflow
claude plugin install kyro-workflow
```

### Option 5: SkillKit (Any Agent)

```bash
npx skillkit install kyro-workflow
```

### Verify Installation

Once installed, confirm everything is working:

```bash
# Inside Claude Code, run any command
/kyro-workflow:status
```

You should see the Kyro status dashboard. If you get "unknown command", check that the plugin is enabled:

```bash
/plugin list
```

---

## Commands

| Command | Purpose |
|---------|---------|
| `/kyro-workflow:forge` | Full cycle: Analyze → Plan → Implement → Review → Commit |
| `/kyro-workflow:status` | Project metrics, velocity trends, debt heatmap |
| `/kyro-workflow:wrap-up` | End-of-session closure ritual with quality check and context handoff |

---

## Agents

| Agent | Purpose | Tools | Key Feature |
|-------|---------|-------|-------------|
| **orchestrator** | Full cycle coordination — analysis, review, debugging, sprint execution | Read, Glob, Grep, Bash, Edit, Write | Memory-enabled, gate protocol, integrated analysis/review/debug protocols |
| **guardian** | Event-based checkpoints — rules loading, drift detection, quality checks | Read, Glob, Grep, Bash | 10 configurable events, invoked by orchestrator at lifecycle moments |

---

## Skills

| Skill | Description |
|-------|-------------|
| `sprint-forge` | Core orchestration — modes (INIT/SPRINT/STATUS), helpers (analyzer, reviewer, learner, metrics, handoff), templates |
---

## Guardian Events (10 Configurable)

The guardian agent runs configurable checkpoints at lifecycle moments, invoked by the orchestrator:

| Event | When | What |
|-------|------|------|
| session_start | New session | Load learned rules, detect active sprint, show session summary |
| pre_phase | Before each phase | Validate state (rules loaded, sprint file exists) |
| post_edit_scan | After code edits | Scan for console.log, debugger, secrets, TODOs |
| pre_commit | Before git commit | Run quality gates (lint, typecheck, tests) |
| test_failure | Test failure detected | Trigger structured debug protocol |
| task_complete | Task completion | Run BLOCKER/WARNING/SUGGESTION checklist |
| drift_check | Configurable timing | Verify work aligns with active sprint task |
| rule_check | Per phase | Verify learned rules not being violated |
| learn_capture | End of session | Capture corrections and patterns as rule proposals |
| session_end | Session close | Save re-entry prompts, session stats, pending learnings |

---

## Database

Learnings, sessions, and debt items stored in SQLite with FTS5 full-text search:

```
.agents/sprint-forge/
├── data.db       # SQLite database (learnings, sessions, debt)
├── rules.md      # Persistent learned rules (accumulated across sprints)
└── sprint-forge/ # Per-project sprint documents
    └── {project}/
        ├── ROADMAP.md
        ├── RE-ENTRY-PROMPTS.md
        ├── README.md
        ├── findings/
        └── sprints/
```

### Schema

- **learnings** — category, rule, mistake, correction, times_applied
- **learnings_fts** — FTS5 virtual table with BM25 ranking
- **sessions** — project, sprint, edit_count, corrections_count, tasks stats
- **debt_items** — item, origin, sprint_target, status, severity, directory

---

## Configuration

### config.json

```json
{
  "database": { "path": ".agents/sprint-forge/data.db" },
  "rules": { "path": ".agents/sprint-forge/rules.md", "auto_load": true },
  "quality_gates": { "run_lint": true, "run_typecheck": true, "run_tests": true },
  "sprint": { "checkpoint_per_phase": true, "require_retro": true, "debt_aged_threshold_sprints": 3 },
  "model_preferences": { "exploration": "haiku", "planning": "sonnet", "implementation": "opus" }
}
```

See [`settings.example.json`](settings.example.json) for production permission and output settings.

---

## Philosophy

1. **Learn from every sprint, apply in the next** — corrections compound into rules
2. **Investigate before planning, plan before implementing** — phases are sequential, gates are mandatory
3. **Every task passes a quality gate before closure** — BLOCKER items block, no exceptions
4. **Mental context is as important as code** — handoffs capture hypotheses, not just file paths
5. **Zero dead time** — parallel tasks via worktrees when dependencies allow
6. **Debt never disappears** — only its status changes
7. **The plan serves execution, not the reverse** — roadmaps adapt to reality

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/getting-started.md) | Quick start walkthrough |
| [Commands Reference](docs/commands-reference.md) | Full command documentation |
| [Agents Reference](docs/agents-reference.md) | Agent capabilities and tools |
| [Rules Guide](docs/rules-guide.md) | Self-correction rules system |
| [Architecture](docs/architecture.md) | System architecture deep dive |
| [Model Selection](docs/model-selection.md) | Model tier selection and cost tradeoffs |
| [Context Management](docs/context-management.md) | Token limits, compaction strategies |

---

## Quick Start

```bash
# 1. Install (inside Claude Code)
/plugin marketplace add SynapSync/kyro-workflow
/plugin install kyro-workflow@kyro-workflow

# 2. Start a project
/kyro-workflow:forge analyze the authentication module    # Full cycle with gates

# 3. Check progress
/kyro-workflow:status                                     # Check progress + metrics
```

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
  <sub>Built by <a href="https://github.com/SynapSync">SynapSync</a> — complete sprint workflow for AI-assisted development.</sub>
</p>
