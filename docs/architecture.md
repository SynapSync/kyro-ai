# Architecture

This document describes the internal architecture of Kyro v2.0, including the Command > Agent > Skill pattern, data flow, storage layout, database schema, hook lifecycle, and differences from the v1.x skill.

---

## Command > Agent > Skill Pattern

Kyro is organized in three layers:

```
User Command (/kyro-workflow:forge, /kyro-workflow:sprint, /kyro-workflow:status, /kyro-workflow:debt, /kyro-workflow:retro)
  |
  v
Agent (explorer, reviewer, debugger, orchestrator)
  |
  v
Skill (sprint-forge, kyro-analyzer, kyro-reviewer, kyro-learner, kyro-metrics, kyro-handoff)
  |
  v
Hook (lifecycle events that fire automatically)
```

### Commands (Entry Points)

Commands are the user-facing interface. Each command is defined as a markdown file in `commands/` with frontmatter that specifies its description and argument hints. Commands do not contain logic -- they describe what should happen and delegate to agents.

| Command | Primary Agent | Purpose |
|---------|--------------|---------|
| `/kyro-workflow:forge` | orchestrator | Full cycle: Analyze, Plan, Implement, Review, Close |
| `/kyro-workflow:sprint` | orchestrator | Generate and/or execute the next sprint |
| `/kyro-workflow:status` | -- (direct) | Read-only metrics report |
| `/kyro-workflow:debt` | -- (direct) | Debt table management |
| `/kyro-workflow:retro` | orchestrator | Sprint retrospective ritual |

### Agents (Execution Engines)

Agents are specialized execution engines defined as markdown files in `agents/`. Each agent has a specific role, toolset, model preference, and set of constraints. Agents are invoked by commands or by other agents (e.g., the orchestrator invokes the explorer, reviewer, and debugger).

| Agent | Toolset | Can Write? | Model | Memory |
|-------|---------|-----------|-------|--------|
| explorer | Read, Glob, Grep, Bash | No | sonnet | project |
| reviewer | Read, Glob, Grep, Bash | No | sonnet | -- |
| debugger | Read, Glob, Grep, Bash | No | opus | project |
| orchestrator | Read, Glob, Grep, Bash, Edit, Write | Yes | opus | project |

Only the orchestrator has write permissions. The explorer, reviewer, and debugger are read-only, which prevents unintended modifications during analysis, validation, and debugging.

### Skills (Domain Knowledge)

Skills provide domain knowledge that agents consume. Each skill is defined in a `SKILL.md` file within the `skills/` directory. Skills are not executable on their own -- they are injected into agents at startup to provide context and guidance.

| Skill | Knowledge Domain |
|-------|-----------------|
| `sprint-forge` | Core orchestration: modes (INIT/SPRINT/STATUS), helpers, templates |
| `kyro-analyzer` | Analysis strategies per work type (audit, feature, bugfix, new project, debt) |
| `kyro-reviewer` | Quality checklist with BLOCKER/WARNING/SUGGESTION classification |
| `kyro-learner` | Per-project rule accumulation and management |
| `kyro-metrics` | Velocity trends, debt heatmap, underestimation pattern detection |
| `kyro-handoff` | Enriched context transfer with mental model (hypotheses, decisions, blockers) |

---

## Data Flow Diagram

```
                    USER
                     |
                     v
              +--------------+
              |   /kyro-workflow:forge     |  (or /kyro-workflow:sprint, /kyro-workflow:status, /kyro-workflow:debt, /kyro-workflow:retro)
              +--------------+
                     |
                     v
            +------------------+
            |   ORCHESTRATOR   |---------> .agents/sprint-forge/rules.md [LOAD]
            +------------------+
                 |    |    |
      +----------+    |    +----------+
      |               |               |
      v               v               v
 +---------+    +-----------+    +----------+
 | EXPLORER |    | REVIEWER  |    | DEBUGGER |
 +---------+    +-----------+    +----------+
      |               |               |
      v               v               v
  Analysis        PASS/FAIL       Root Cause
  Report          Verdict         + Fix Proposal
      |               |               |
      +-------+-------+-------+-------+
              |               |
              v               v
    .agents/sprint-forge/
    sprint-forge/{project}/
    ├── findings/
    ├── data.db
    ├── rules.md
    ├── sprints/
    ├── handoffs/
    ├── ROADMAP.md
    └── RE-ENTRY-PROMPTS.md

              HOOKS fire at every lifecycle event
              (SessionStart, PreToolUse, PostToolUse,
               Stop, SessionEnd, UserPromptSubmit,
               PreCompact, SubagentStart/Stop,
               TaskCompleted, PostToolUseFailure)
```

### Flow for /kyro-workflow:forge

1. **Rules Loading** -- Orchestrator reads `.agents/sprint-forge/rules.md`
2. **Analysis** -- Orchestrator delegates to Explorer agent. Explorer reads the codebase and produces an analysis report. Findings are written to `findings/`.
3. **Gate 1** -- User approves analysis.
4. **Planning** -- Orchestrator generates a sprint document with phases and tasks. Writes to `sprints/`.
5. **Gate 2** -- User approves the plan.
6. **Implementation** -- Orchestrator executes tasks. After each task, invokes Reviewer. On failure, invokes Debugger. Checkpoints saved per phase.
7. **Gate 3** -- User approves implementation.
8. **Review and Close** -- Orchestrator runs retro, updates debt, proposes rules, updates re-entry prompts.

### Flow for /kyro-workflow:sprint

Same as phases 4-8 of `/kyro-workflow:forge`, but can also run phase 4 alone (generate only) or phases 5-8 alone (execute only).

### Flow for /kyro-workflow:status

Direct read of all project files. No agents involved. Computes metrics and outputs a report.

---

## Storage Locations

Kyro uses two storage locations:

### Per-Project: `.agents/sprint-forge/`

Stores data that persists across sprints within this project.

```
.agents/sprint-forge/
├── data.db       # SQLite database
└── rules.md      # Learned rules (accumulated across sprints)
```

The database path is configurable via `config.json` (`database.path`) or the `KYRO_DB_PATH` environment variable.

### Per-Project: `.agents/sprint-forge/{project}/`

Stores all sprint documents for a specific project. Created during INIT and used by all subsequent commands.

```
.agents/sprint-forge/{project-name}/
├── README.md              # Project overview with paths and baseline
├── ROADMAP.md             # Adaptive roadmap with sprint definitions
├── RE-ENTRY-PROMPTS.md    # Context recovery prompts
├── findings/              # One file per analysis finding
│   ├── 01-*.md
│   └── ...
├── sprints/               # One file per sprint
│   ├── SPRINT-1-*.md
│   └── ...
└── handoffs/              # Enriched session handoff documents
    └── YYYY-MM-DD-sprint-N.md
```

The output directory path (`{output_kyro_dir}`) is resolved once at the start of any mode and embedded in `README.md` and `RE-ENTRY-PROMPTS.md`. These two files are the source of truth for the path.

---

## Database Schema

Kyro uses SQLite with WAL mode and FTS5 full-text search. The schema is defined in `src/db/schema.sql`.

### Tables

#### learnings

Stores captured rules and corrections.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key (auto-increment) |
| `created_at` | TEXT | Timestamp (default: now) |
| `project` | TEXT | Project name (required) |
| `category` | TEXT | Rule category: estimation, quality, architecture, testing, process (required) |
| `rule` | TEXT | The rule text (required) |
| `mistake` | TEXT | What went wrong |
| `correction` | TEXT | How the user corrected the agent |
| `sprint` | TEXT | Sprint where the rule was learned |
| `times_applied` | INTEGER | Application counter (default: 0) |

#### learnings_fts

FTS5 virtual table that provides full-text search over the `learnings` table. Uses the Porter stemmer for tokenization and BM25 ranking for search result ordering.

Indexed columns: `rule`, `category`, `mistake`, `correction`.

Kept in sync with the `learnings` table via INSERT/DELETE/UPDATE triggers.

#### sessions

Tracks session metadata for metrics.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key (auto-increment) |
| `project` | TEXT | Project name (required) |
| `started_at` | TEXT | Session start timestamp (default: now) |
| `ended_at` | TEXT | Session end timestamp |
| `sprint` | TEXT | Active sprint during this session |
| `edit_count` | INTEGER | Number of edits made (default: 0) |
| `corrections_count` | INTEGER | Number of user corrections (default: 0) |
| `tasks_completed` | INTEGER | Tasks completed this session (default: 0) |
| `tasks_total` | INTEGER | Total tasks in active sprint (default: 0) |

#### debt_items

Tracks technical debt across sprints.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key (auto-increment) |
| `created_at` | TEXT | Timestamp (default: now) |
| `project` | TEXT | Project name (required) |
| `item` | TEXT | Debt description (required) |
| `origin` | TEXT | Where discovered: "INIT finding", "Sprint N phase", "Sprint N retro" (required) |
| `sprint_target` | TEXT | Which sprint should address it |
| `status` | TEXT | One of: `open`, `in-progress`, `resolved`, `deferred` (default: open) |
| `resolved_in` | TEXT | Sprint where it was resolved |
| `directory` | TEXT | Source directory (for heatmap) |
| `severity` | TEXT | One of: `critical`, `high`, `medium`, `low` (default: medium) |

---

## Hook Lifecycle

Hooks fire automatically at specific points in the Claude Code session lifecycle. They are defined in `hooks/hooks.json` and implemented as Node.js scripts in `scripts/`.

```
Session Lifecycle:
  SessionStart ------> [Load rules, show sprint]
       |
       v
  User Prompt -------> [UserPromptSubmit: drift + rule check]
       |
       v
  Tool Call ----------> [PreToolUse: track edits / remind gates]
       |
       v
  Tool Result --------> [PostToolUse: check artifacts / detect failures]
       |                 [PostToolUseFailure: suggest debugger]
       v
  Subagent -----------> [SubagentStart / SubagentStop: log lifecycle]
       |
       v
  Task Done ----------> [TaskCompleted: reviewer checklist]
       |
       v
  Response -----------> [Stop: session check + learn capture]
       |
       v
  Context Full -------> [PreCompact: save re-entry state]
       |
       v
  Session Close ------> [SessionEnd: save stats, prompt learnings]
```

Hook scripts follow the Claude Code hook protocol:
- Receive event data as JSON on stdin
- Emit the (possibly modified) data as JSON on stdout
- Use stderr for user-visible messages

See [hooks-reference.md](hooks-reference.md) for detailed documentation of each hook.

---

## How the Workflow Differs from v1.x

Kyro v2.0 is a full workflow that replaces the v1.x single-skill approach.

### v1.x: Single Skill

In v1.x, `sprint-forge` (then called `kyro-workflow`) was a single skill with mode detection (INIT/SPRINT/STATUS). The skill contained all logic inline and had no hooks, no specialized agents, and no persistent learning.

```
v1.x:  User message --> sprint-forge skill --> output files
```

### v2.0: Workflow Architecture

In v2.0, the skill is decomposed into commands, agents, skills, and hooks. Each component has a single responsibility.

```
v2.0:  User command --> Agent (orchestrator/explorer/reviewer/debugger)
                           --> Skill (domain knowledge)
                           --> Hook (lifecycle automation)
                           --> Database (persistent state)
```

### Comparison Table

| Dimension | v1.x (Skill) | v2.0 (Workflow) |
|-----------|-------------|-----------------|
| Type | Single skill | Full workflow (commands + agents + skills + hooks) |
| Entry point | Text triggers detected by skill | Slash commands (`/kyro-workflow:forge`, `/kyro-workflow:sprint`, etc.) |
| Learning | Per-project retro only | Persistent rules across sprints via `.agents/sprint-forge/rules.md` |
| Agents | 1 (the skill itself) | 4 specialized (explorer, reviewer, debugger, orchestrator) |
| Hooks | 0 | 12 lifecycle events |
| Quality gates | 0 | Per-task (BLOCKER/WARNING/SUGGESTION) + per-phase gates with approval |
| Metrics | Basic STATUS report | Velocity trends, debt heatmap, estimation patterns, sprint health score |
| Context transfer | Re-entry prompts (file paths) | Enriched handoff (mental context: hypotheses, decisions, blockers) |
| Database | None | SQLite + FTS5 (learnings, sessions, debt) |
| Parallel execution | Not supported | Worktree-based parallel tasks when dependencies allow |
| Model selection | Single model | Per-phase model preferences (haiku for exploration, sonnet for planning, opus for implementation) |

### What Moved Where

| v1.x Component | v2.0 Location |
|----------------|---------------|
| INIT mode logic | `skills/sprint-forge/assets/modes/INIT.md` + `agents/explorer.md` |
| SPRINT mode logic | `skills/sprint-forge/assets/modes/SPRINT.md` + `agents/orchestrator.md` |
| STATUS mode logic | `skills/sprint-forge/assets/modes/STATUS.md` + `skills/kyro-metrics/` |
| Analysis helpers | `skills/kyro-analyzer/` |
| Quality validation | `skills/kyro-reviewer/` + `agents/reviewer.md` |
| Debugging | `agents/debugger.md` (new in v2.0) |
| Learning/rules | `skills/kyro-learner/` + hooks (new in v2.0) |
| Context handoff | `skills/kyro-handoff/` (enriched in v2.0) |
| Templates | `skills/sprint-forge/assets/templates/` (unchanged) |

The v1.x skill still exists as `skills/sprint-forge/` and provides the core orchestration knowledge (modes, helpers, templates). The new agents, commands, and hooks layer on top of it.
