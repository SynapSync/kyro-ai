# Getting Started with Kyro

Kyro is a workflow system that orchestrates sprint-based project execution through specialized agents, lifecycle hooks, and persistent learning. This guide walks you through installation, first run, and core concepts.

---

## Prerequisites

- **Node.js >= 18** -- required for the SQLite database and hook scripts
- **Claude Code** -- Kyro is built as a Claude Code plugin (also compatible with any agent via SkillKit)
- **Git** -- recommended for worktree-based parallel execution

Verify your Node.js version:

```bash
node --version
# v18.0.0 or higher
```

---

## Installation

### Method 1: Plugin Install (Recommended)

```bash
/plugin install SynapSync/kyro-workflow
```

This installs Kyro as a Claude Code plugin with all commands, agents, hooks, and skills registered automatically.

### Method 2: Manual Clone

```bash
git clone https://github.com/SynapSync/kyro-workflow.git ~/.claude/plugins/kyro-workflow
cd ~/.claude/plugins/kyro-workflow
npm install && npm run build
```

Then launch Claude Code with the plugin:

```bash
claude --plugin-dir ~/.claude/plugins/kyro-workflow
```

### Method 3: SkillKit (Any Agent)

```bash
npx skillkit install kyro-workflow
```

This works with any AI coding agent that supports the SkillKit protocol, not just Claude Code.

---

## First Run

Once installed, navigate to a project directory and run the `/forge` command:

```
/forge analyze the authentication module
```

This starts the full sprint cycle:

1. The **explorer agent** analyzes the codebase (read-only)
2. You approve the analysis at **Gate 1**
3. Kyro generates a sprint plan with phases and tasks
4. You approve the plan at **Gate 2**
5. Tasks are executed one by one, each validated by the **reviewer agent**
6. You approve the implementation at **Gate 3**
7. A retrospective is run and the sprint is closed

You can also run steps individually:

```
/sprint generate          # Generate the next sprint without executing
/sprint execute           # Execute an already-generated sprint
/status                   # Check project progress and metrics
/debt list                # View technical debt
/retro                    # Run the retrospective ritual
```

---

## Understanding the Output Structure

After running `/forge` (INIT mode), Kyro creates a project workspace:

```
.agents/kyro/{project-name}/
├── README.md              # Project overview, paths, baseline metrics
├── ROADMAP.md             # Adaptive roadmap with sprint definitions
├── RE-ENTRY-PROMPTS.md    # Context recovery prompts for new sessions
├── findings/              # Analysis findings, one file per finding
│   ├── 01-architecture-issues.md
│   ├── 02-test-coverage-gaps.md
│   └── ...
├── sprints/               # Sprint documents, one file per sprint
│   ├── SPRINT-1-architecture-cleanup.md
│   ├── SPRINT-2-api-consistency.md
│   └── ...
└── handoffs/              # Enriched session handoff documents
    └── 2026-03-08-sprint-3.md
```

Global data is stored in `~/.kyro/`:

```
~/.kyro/
├── data.db       # SQLite database (learnings, sessions, debt items)
└── rules.md      # Persistent learned rules (accumulated across all projects)
```

### Key Files

| File | Purpose |
|------|---------|
| `ROADMAP.md` | Defines planned sprints, dependencies, and suggested phases. Updated adaptively as execution reveals changes. |
| `RE-ENTRY-PROMPTS.md` | Contains copy-paste prompts for recovering context in a new session. Updated after every sprint. |
| `findings/*.md` | Each finding from the initial analysis becomes a separate file with severity, evidence, and recommendations. |
| `sprints/SPRINT-N-*.md` | Each sprint document includes phases, tasks, debt table, retro, and recommendations. |
| `~/.kyro/rules.md` | Learned rules that apply across all projects. Loaded automatically at session start. |

---

## Key Concepts

### Modes

Kyro operates in three modes, determined by your intent:

| Mode | When to Use | What It Does |
|------|-------------|--------------|
| **INIT** | Starting a new project workflow | Analyzes the codebase, generates findings, creates a roadmap, scaffolds the output directory |
| **SPRINT** | Ready to work on the next iteration | Generates a sprint from the roadmap and previous retro, optionally executes it task by task |
| **STATUS** | Checking progress | Reads all sprint files and reports metrics, debt heatmap, velocity trends |

### Gates

Gates are mandatory approval checkpoints between phases. Kyro never proceeds past a gate without your explicit approval. There are three gates in the `/forge` cycle:

- **Gate 1** -- after analysis, before planning
- **Gate 2** -- after sprint plan generation, before implementation
- **Gate 3** -- after implementation, before review and close

At each gate, you can:
- **proceed** -- continue to the next phase
- **adjust** -- modify the output before continuing
- **cancel** -- stop the workflow

### Checkpoints

Sprint files are saved to disk after each phase completes during execution. This ensures progress survives interruptions (session timeout, context overflow, agent crash) without fragmenting focus during task-to-task execution within a phase.

### Quality Gates

Every task passes through a quality checklist before it can be marked as done:

- **BLOCKER** -- must pass (tests, type safety, no debug artifacts, no secrets)
- **WARNING** -- should pass, requires justification to skip (test coverage, documentation)
- **SUGGESTION** -- noted for retrospective (conventions, refactoring opportunities)

### The Self-Correction Loop

When you correct the agent during a sprint, the correction can become a persistent rule:

```
User corrects agent
    |
Agent proposes rule
    |
User approves
    |
Rule saved to ~/.kyro/rules.md
    |
Future sessions load rules automatically
    |
Same mistake never happens again
```

Rules are specific, dated, and tied to the project where they were learned. See [rules-guide.md](rules-guide.md) for details.

### Debt Tracking

Technical debt items are tracked formally across sprints. Items are never deleted -- only their status changes (open, in-progress, resolved, deferred). Items open for more than 3 sprints trigger an escalation prompt.

---

## Next Steps

- [Commands Reference](commands-reference.md) -- detailed syntax and examples for all 5 commands
- [Agents Reference](agents-reference.md) -- how the 4 specialized agents work
- [Hooks Reference](hooks-reference.md) -- the 12 lifecycle hooks and how to customize them
- [Rules Guide](rules-guide.md) -- the cross-project learning system
- [Architecture](architecture.md) -- system design and data flow
