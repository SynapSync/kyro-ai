# Architecture

This document describes the internal architecture of Kyro v2.0, including the Command > Agent > Skill pattern, data flow, storage layout, database schema, guardian events, and differences from the v1.x skill.

---

## Command > Agent > Skill Pattern

Kyro is organized in three layers:

```
User Command (/kyro-workflow:forge, /kyro-workflow:status, /kyro-workflow:wrap-up)
  |
  v
Agent (orchestrator)
  |
  +---> Skill (sprint-forge)
  |
  +---> Agent (guardian — configurable event-based checkpoints)
```

### Commands (Entry Points)

Commands are the user-facing interface. Each command is defined as a markdown file in `commands/` with frontmatter that specifies its description and argument hints. Commands do not contain logic -- they describe what should happen and delegate to agents.

| Command | Primary Agent | Purpose |
|---------|--------------|---------|
| `/kyro-workflow:forge` | orchestrator | Full cycle: Analyze, Plan, Implement, Review, Close |
| `/kyro-workflow:status` | -- (direct) | Read-only metrics report |
| `/kyro-workflow:wrap-up` | -- (direct) | End-of-session closure ritual with quality check and context handoff |

### Agent (Execution Engine)

The orchestrator is the primary agent, defined as a markdown file in `agents/`. It handles all phases of the sprint lifecycle through specialized protocols: analysis (read-only exploration), review (quality validation), debugging (root cause analysis), and full cycle coordination. It invokes the guardian agent at lifecycle moments for configurable event-based checkpoints.

| Agent | Toolset | Can Write? | Model | Memory |
|-------|---------|-----------|-------|--------|
| orchestrator | Read, Glob, Grep, Bash, Edit, Write | Yes | opus | project |

The orchestrator self-constrains to read-only operations during analysis phases and uses the review checklist and debug protocol as internal workflows.

### Skills (Domain Knowledge)

Skills provide domain knowledge that agents consume. Each skill is defined in a `SKILL.md` file within the `skills/` directory. Skills are not executable on their own -- they are injected into agents at startup to provide context and guidance.

| Skill | Knowledge Domain |
|-------|-----------------|
| `sprint-forge` | Core orchestration: modes (INIT/SPRINT/STATUS), helpers (analyzer, reviewer, learner, metrics, handoff), templates |

---

## Data Flow Diagram

```
                    USER
                     |
                     v
              +--------------+
              |   /kyro-workflow:forge     |  (or /kyro-workflow:status, /kyro-workflow:wrap-up)
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
  [Analysis      [Review         [Debug
   Protocol]      Checklist]      Protocol]
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

              GUARDIAN runs configurable checkpoints
              at lifecycle moments (session_start, pre_tool_use,
              post_tool_use, stop, session_end, user_prompt_submit,
              pre_compact, subagent_start, subagent_stop,
              task_completed)
```

### Flow for /kyro-workflow:forge

1. **Rules Loading** -- Orchestrator reads `.agents/sprint-forge/rules.md`
2. **Analysis** -- Orchestrator runs the analysis protocol. Reads the codebase and produces an analysis report. Findings are written to `findings/`.
3. **Gate 1** -- User approves analysis.
4. **Planning** -- Orchestrator generates a sprint document with phases and tasks. Writes to `sprints/`.
5. **Gate 2** -- User approves the plan.
6. **Implementation** -- Orchestrator executes tasks. After each task, runs the review checklist. On failure, runs the debug protocol. Checkpoints saved per phase.
7. **Gate 3** -- User approves implementation.
8. **Review and Close** -- Orchestrator runs retro, updates debt, proposes rules, updates re-entry prompts.

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

### Per-Scope: `.agents/sprint-forge/{scope}/`

Stores all sprint documents for a specific scope (where `{scope}` is the work topic in kebab-case, e.g., `oauth-implementation`, `ui-redesign`). Created during INIT and used by all subsequent commands.

```
.agents/sprint-forge/{scope}/
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

## Guardian Events

The guardian agent runs configurable checkpoints at lifecycle moments. The orchestrator invokes the guardian at key points during sprint execution. Events are defined in `agents/guardian.md`.

```
Session Lifecycle:
  session_start ------> [Load rules, show sprint]
       |
       v
  user_prompt_submit -> [Drift + rule check]
       |
       v
  pre_tool_use -------> [Track edits / remind gates]
       |
       v
  post_tool_use ------> [Check artifacts / detect failures]
       |
       v
  subagent_start/stop > [Log lifecycle]
       |
       v
  task_completed -----> [Review checklist]
       |
       v
  stop ---------------> [Session check + learn capture]
       |
       v
  pre_compact --------> [Save re-entry state]
       |
       v
  session_end --------> [Save stats, prompt learnings]
```

See [agents-reference.md](agents-reference.md) for detailed documentation of the guardian agent.

---

## How the Workflow Differs from v1.x

Kyro v2.0 is a full workflow that replaces the v1.x single-skill approach.

### v1.x: Single Skill

In v1.x, `sprint-forge` (then called `kyro-workflow`) was a single skill with mode detection (INIT/SPRINT/STATUS). The skill contained all logic inline and had no guardian events, no specialized agents, and no persistent learning.

```
v1.x:  User message --> sprint-forge skill --> output files
```

### v2.0: Workflow Architecture

In v2.0, the skill is decomposed into commands, agents, skills, and hooks. Each component has a single responsibility.

```
v2.0:  User command --> Agent (orchestrator)
                           --> Skill (domain knowledge)
                           --> Agent (guardian — lifecycle checkpoints)
                           --> Database (persistent state)
```

### Comparison Table

| Dimension | v1.x (Skill) | v2.0 (Workflow) |
|-----------|-------------|-----------------|
| Type | Single skill | Full workflow (commands + agents + skills + guardian events) |
| Entry point | Text triggers detected by skill | Slash commands (`/kyro-workflow:forge`, `/kyro-workflow:status`, `/kyro-workflow:wrap-up`) |
| Learning | Per-project retro only | Persistent rules across sprints via `.agents/sprint-forge/rules.md` |
| Agents | 1 (the skill itself) | 2 (orchestrator + guardian with 10 configurable events) |
| Quality gates | 0 | Per-task (BLOCKER/WARNING/SUGGESTION) + per-phase gates with approval |
| Metrics | Basic STATUS report | Velocity trends, debt heatmap, estimation patterns, sprint health score |
| Context transfer | Re-entry prompts (file paths) | Enriched handoff (mental context: hypotheses, decisions, blockers) |
| Database | None | SQLite + FTS5 (learnings, sessions, debt) |
| Model selection | Single model | Per-phase model preferences (haiku for exploration, sonnet for planning, opus for implementation) |

### What Moved Where

| v1.x Component | v2.0 Location |
|----------------|---------------|
| INIT mode logic | `skills/sprint-forge/assets/modes/INIT.md` + `agents/orchestrator.md` (analysis protocol) |
| SPRINT mode logic | `skills/sprint-forge/assets/modes/SPRINT.md` + `agents/orchestrator.md` |
| STATUS mode logic | `skills/sprint-forge/assets/modes/STATUS.md` + `skills/sprint-forge/assets/helpers/metrics.md` |
| Analysis helpers | `skills/sprint-forge/assets/helpers/analyzer.md` |
| Quality validation | `skills/sprint-forge/assets/helpers/reviewer.md` + `agents/orchestrator.md` (review checklist) |
| Debugging | `agents/orchestrator.md` (debug protocol) |
| Learning/rules | `skills/sprint-forge/assets/helpers/learner.md` + guardian events (new in v2.0) |
| Context handoff | `skills/sprint-forge/assets/helpers/handoff.md` (enriched in v2.0) |
| Templates | `skills/sprint-forge/assets/templates/` (unchanged) |

The v1.x skill still exists as `skills/sprint-forge/` and provides the core orchestration knowledge (modes, helpers, templates). The new agents, commands, and guardian events layer on top of it.
