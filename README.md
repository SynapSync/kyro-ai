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
  4 agents &bull; 12 hooks &bull; 9 commands &bull; 7 skills &bull; Adaptive per-project learning<br/>
  Built for <b>Claude Code</b>. Compatible with any AI coding agent via SkillKit.
</p>

---

## What Is Kyro?

Kyro is a **workflow** that orchestrates iterative project execution through specialized agents, lifecycle hooks, and persistent learning. It evolves from the [sprint-forge skill](https://github.com/SynapSync/skills-registry) into a full Command > Agent > Skill architecture.

Unlike rigid project planners, Kyro:

- **Analyzes first** — deep codebase exploration before committing to a plan
- **Generates sprints one at a time** — each sprint feeds from the previous one's retro
- **Learns across sprints** — corrections become persistent rules in `.agents/kyro/rules.md`
- **Validates at every step** — BLOCKER/WARNING/SUGGESTION checklist per task
- **Adapts the roadmap** — the plan evolves based on what execution reveals
- **Persists context** — re-entry prompts + enriched handoffs with mental model

---

## What's New in v2.0

<table>
<tr><td><b>4 Agents</b></td><td>Explorer (read-only analysis), Reviewer (task validation), Debugger (root cause), Orchestrator (full cycle)</td></tr>
<tr><td><b>9 Commands</b></td><td><code>/kyro-workflow:forge</code>, <code>/kyro-workflow:sprint</code>, <code>/kyro-workflow:status</code>, <code>/kyro-workflow:debt</code>, <code>/kyro-workflow:retro</code>, <code>/kyro-workflow:wrap-up</code>, <code>/kyro-workflow:insights</code>, <code>/kyro-workflow:deslop</code>, <code>/kyro-workflow:parallel</code></td></tr>
<tr><td><b>12 Hooks</b></td><td>SessionStart, PreToolUse, PostToolUse, Stop, SessionEnd, UserPromptSubmit, PreCompact, SubagentStart/Stop, TaskCompleted, PostToolUseFailure</td></tr>
<tr><td><b>Per-Project Learning</b></td><td>Corrections become rules in <code>.agents/kyro/rules.md</code> — applied automatically in future sprints</td></tr>
<tr><td><b>Validation Gates</b></td><td>BLOCKER/WARNING/SUGGESTION checklist per task, phase gates with user approval</td></tr>
<tr><td><b>Velocity Metrics</b></td><td>Sprint velocity trends, debt heatmap, underestimation pattern detection</td></tr>
<tr><td><b>Enriched Handoffs</b></td><td>Mental context: active hypotheses, pending decisions, blockers, next action</td></tr>
<tr><td><b>SQLite + FTS5</b></td><td>Searchable learnings, session stats, and debt tracking database</td></tr>
</table>

---

## How It Works

### The `/kyro-workflow:forge` Cycle

```
[PHASE 1: ANALYZE]  → Explorer agent investigates codebase (read-only)
        ↓
   GATE 1: User approves analysis
        ↓
[PHASE 2: PLAN]     → Generate sprint with phases, tasks, and estimates
        ↓
   GATE 2: User approves sprint plan
        ↓
[PHASE 3: IMPLEMENT] → Execute task by task
   ├── After each task → Reviewer validates (BLOCKER/WARNING/SUGGESTION)
   ├── On failure     → Debugger investigates root cause
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
Rule saved to .agents/kyro/rules.md
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
  └── Agent (specialized execution engine)
        └── Skill (domain knowledge, injected at startup)
              └── Hook (lifecycle event, fires automatically)
```

```
kyro-workflow/
├── agents/                     # 4 specialized agents
│   ├── explorer.md             # Read-only codebase analysis (INIT)
│   ├── reviewer.md             # Task quality validation (SPRINT)
│   ├── debugger.md             # Root cause investigation (on failure)
│   └── orchestrator.md         # Full cycle coordinator (/kyro-workflow:forge)
│
├── commands/                   # 9 slash commands
│   ├── forge.md                # /kyro-workflow:forge — full cycle with gates
│   ├── sprint.md               # /kyro-workflow:sprint — generate/execute next sprint
│   ├── status.md               # /kyro-workflow:status — metrics + debt heatmap
│   ├── debt.md                 # /kyro-workflow:debt — manage technical debt
│   ├── retro.md                # /kyro-workflow:retro — sprint retrospective ritual
│   ├── wrap-up.md              # /kyro-workflow:wrap-up — session closure ritual
│   ├── insights.md             # /kyro-workflow:insights — DB-backed analytics
│   ├── deslop.md               # /kyro-workflow:deslop — AI slop removal
│   └── parallel.md             # /kyro-workflow:parallel — worktree parallel execution
│
├── skills/                     # 7 skills (domain knowledge)
│   ├── sprint-forge/            # Core orchestration (base skill from v1.x)
│   │   ├── SKILL.md
│   │   └── assets/             # Modes, helpers, templates
│   ├── kyro-analyzer/        # Analysis strategies per work type
│   ├── kyro-reviewer/        # Quality checklist (BLOCKER/WARNING/SUGGESTION)
│   ├── kyro-learner/         # Per-project rule accumulation
│   ├── kyro-metrics/         # Velocity trends + debt heatmap
│   ├── kyro-handoff/         # Enriched context transfer
│   └── deslop/                 # AI slop detection and removal
│
├── docs/                       # 8 documentation guides
│   ├── getting-started.md      # Quick start walkthrough
│   ├── commands-reference.md   # Full command documentation
│   ├── agents-reference.md     # Agent capabilities and tools
│   ├── hooks-reference.md      # Hook event documentation
│   ├── rules-guide.md          # Self-correction rules system
│   ├── architecture.md         # System architecture deep dive
│   ├── model-selection.md      # Model tier selection guide
│   └── context-management.md   # Token limits and compaction strategies
│
├── hooks/                      # Lifecycle event handlers
│   └── hooks.json              # 12 hook definitions
├── scripts/                    # 11 Node.js hook handler + test scripts
│
├── src/                        # TypeScript source (SQLite + FTS5)
│   ├── db/                     # Database init, schema, store
│   └── search/                 # Full-text search with BM25 ranking
│
├── .github/workflows/          # CI/CD pipelines
│   ├── ci.yml                  # Build + test on push/PR
│   └── release.yml             # GitHub release on tag push
│
├── .claude-plugin/             # Claude Code plugin metadata
├── .cursor-plugin/             # Cursor plugin metadata
├── config.json                 # Workflow configuration
├── marketplace.json            # Plugin marketplace listing
├── settings.example.json       # Production settings template
├── WORKFLOW.yaml               # Workflow definition
└── CLAUDE.md                   # Development instructions
```

---

## Installation

### Claude Code — Plugin Install

```bash
/plugin install SynapSync/kyro-workflow
```

### Claude Code — Manual

```bash
git clone https://github.com/SynapSync/kyro-workflow.git ~/.claude/plugins/kyro-workflow
cd ~/.claude/plugins/kyro-workflow
npm install && npm run build
```

Then load it:

```bash
claude --plugin-dir ~/.claude/plugins/kyro-workflow
```

### SkillKit (Any Agent)

```bash
npx skillkit install kyro-workflow
```

---

## Commands

| Command | Purpose |
|---------|---------|
| `/kyro-workflow:forge` | Full cycle: Analyze → Plan → Implement → Review → Commit |
| `/kyro-workflow:sprint` | Generate and/or execute the next sprint |
| `/kyro-workflow:status` | Project metrics, velocity trends, debt heatmap |
| `/kyro-workflow:debt` | List, add, resolve, or escalate technical debt |
| `/kyro-workflow:retro` | Sprint retrospective ritual with rule proposals |
| `/kyro-workflow:wrap-up` | End-of-session closure ritual with quality check and context handoff |
| `/kyro-workflow:insights` | Database-backed analytics — correction trends, learning heatmap, velocity |
| `/kyro-workflow:deslop` | Detect and remove AI-generated slop — unnecessary comments, over-engineering |
| `/kyro-workflow:parallel` | Analyze sprint tasks for parallel execution via git worktrees |

---

## Agents

| Agent | Purpose | Tools | Key Feature |
|-------|---------|-------|-------------|
| **explorer** | Read-only codebase analysis | Read, Glob, Grep, Bash | Worktree-isolated, never writes |
| **reviewer** | Task quality validation | Read, Glob, Grep, Bash | BLOCKER/WARNING/SUGGESTION tiers |
| **debugger** | Root cause investigation | Read, Glob, Grep, Bash | Hypothesis-driven, escalation protocol |
| **orchestrator** | Full cycle coordination | Read, Glob, Grep, Bash, Edit, Write | Memory-enabled, gate protocol |

---

## Skills

| Skill | Description |
|-------|-------------|
| `sprint-forge` | Core orchestration — modes (INIT/SPRINT/STATUS), helpers, templates |
| `kyro-analyzer` | Analysis strategies per work type (audit, feature, bugfix, new project, debt) |
| `kyro-reviewer` | Quality checklist with BLOCKER/WARNING/SUGGESTION classification |
| `kyro-learner` | Per-project rule accumulation via `.agents/kyro/rules.md` |
| `kyro-metrics` | Velocity trends, debt heatmap, underestimation pattern detection |
| `kyro-handoff` | Enriched session handoff with mental context (hypotheses, decisions, blockers) |
| `deslop` | AI slop detection and removal — 7 categories, confidence ratings, safety rules |

---

## Hooks (12 Events)

| Hook | When | What |
|------|------|------|
| SessionStart | New session | Load learned rules, show active sprint |
| PreToolUse | Before edits | Track edit count, quality gate reminders |
| PreToolUse | Before git commit | Remind about quality gates |
| PostToolUse | After code edits | Check for debug artifacts, secrets, TODOs |
| PostToolUse | After tests | Detect failures, suggest debugger |
| Stop | Each response | Session check, capture [LEARN] blocks |
| SessionEnd | Session close | Save stats, prompt for learnings |
| UserPromptSubmit | Each prompt | Drift detection, rule violation check |
| PreCompact | Before compaction | Save re-entry state |
| SubagentStart/Stop | Agent lifecycle | Log for observability |
| TaskCompleted | Task marked done | Post-task quality checklist |
| PostToolUseFailure | Tool fails | Suggest debugger invocation |

---

## Database

Learnings, sessions, and debt items stored in SQLite with FTS5 full-text search:

```
.agents/kyro/
├── data.db       # SQLite database (learnings, sessions, debt)
└── rules.md      # Persistent learned rules (accumulated across sprints)
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
  "database": { "path": ".agents/kyro/data.db" },
  "rules": { "path": ".agents/kyro/rules.md", "auto_load": true },
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

## Comparison: v1.x Skill vs v2.0 Workflow

| Dimension | v1.x (Skill) | v2.0 (Workflow) |
|-----------|--------------|-----------------|
| Type | Single skill | Full workflow |
| Learning | Per-project retro | Persistent rules across sprints |
| Agents | 1 (the skill itself) | 4 specialized (explorer, reviewer, debugger, orchestrator) |
| Hooks | 0 | 12 lifecycle events |
| Commands | 0 (text triggers) | 9 commands (/kyro-workflow:forge, /kyro-workflow:sprint, /kyro-workflow:status, /kyro-workflow:debt, /kyro-workflow:retro, /kyro-workflow:wrap-up, /kyro-workflow:insights, /kyro-workflow:deslop, /kyro-workflow:parallel) |
| Quality gates | 0 | Per-task (BLOCKER/WARNING/SUGGESTION) + per-phase |
| Metrics | Basic STATUS | Velocity trends + debt heatmap + estimation patterns |
| Context transfer | Re-entry prompts (files) | Enriched handoff (mental context) |
| Database | None | SQLite + FTS5 (learnings, sessions, debt) |
| CI/CD | None | 2 GitHub Actions workflows (CI + Release) |
| Documentation | README only | 8 guides + SOUL.md template |
| Distribution | Manual clone | marketplace.json + npm pack ready |

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/getting-started.md) | Quick start walkthrough |
| [Commands Reference](docs/commands-reference.md) | Full command documentation |
| [Agents Reference](docs/agents-reference.md) | Agent capabilities and tools |
| [Hooks Reference](docs/hooks-reference.md) | Hook event documentation |
| [Rules Guide](docs/rules-guide.md) | Self-correction rules system |
| [Architecture](docs/architecture.md) | System architecture deep dive |
| [Model Selection](docs/model-selection.md) | Model tier selection and cost tradeoffs |
| [Context Management](docs/context-management.md) | Token limits, compaction strategies |

---

## Quick Start

```bash
# 1. Install
git clone https://github.com/SynapSync/kyro-workflow.git ~/.claude/plugins/kyro-workflow
cd ~/.claude/plugins/kyro-workflow && npm install && npm run build

# 2. Start a project
/kyro-workflow:forge analyze the authentication module    # Full cycle with gates

# 3. Or step by step
/kyro-workflow:sprint generate                            # Generate next sprint
/kyro-workflow:sprint execute                             # Execute current sprint
/kyro-workflow:status                                     # Check progress + metrics
/kyro-workflow:debt escalate                              # Flag aged debt items
/kyro-workflow:retro                                      # Run retrospective ritual
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
