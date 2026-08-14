# Architecture

This document describes Kyro's Command > Agent > Skill workflow architecture and the markdown artifacts used to preserve project context.

---

## Command > Agent > Skill Pattern

Kyro is organized in three layers:

```
User Command (/kyro:forge, /kyro:status, /kyro:task-context, /kyro:idea, /kyro:qa, /kyro:scope-retire)
  |
  v
Agent (orchestrator)
  |
  +---> Skill (sprint-forge)
  |
  +---> Skill (qa-review)
```

### Commands

Commands are the user-facing interface. Each command is defined as a markdown file in `commands/` with frontmatter that specifies its description and argument hints.

| Command | Primary Agent | Purpose |
|---------|--------------|---------|
| `/kyro:forge` | orchestrator | Full cycle: Analyze, Plan, Implement, Review, Close |
| `/kyro:status` | orchestrator | Read-only project progress and debt summary |
| `/kyro:task-context` | orchestrator | Read-only prompt generation for a fresh agent context |
| `/kyro:idea` | direct skill | Optional evidence-grounded pre-scope planning |
| `/kyro:qa` | direct skill | Independent scope certification audit |
| `/kyro:scope-retire` | direct router | Human-gated terminal lifecycle operation |

### Agent

The orchestrator coordinates the full sprint lifecycle. It performs read-only analysis during discovery, generates plans, executes approved tasks, runs validation, handles debugging, updates sprint artifacts, and owns lifecycle checkpoints.

| Agent | Toolset | Can Write? | Role |
|-------|---------|-----------|------|
| orchestrator | Read, Glob, Grep, Bash, Edit, Write | Yes | Full lifecycle coordination |

### Skills

Skills provide domain knowledge that the orchestrator consumes. They are **loaded as instruction files** (the router reads `SKILL.md` and the routed mode), not spawned as subagents — the only Kyro agent is `orchestrator`. To generate or materialize a sprint, use `/kyro:forge` or the tool-owned `kyro plan --from` verb; never invoke `sprint-forge` through the Task/Agent tool.

### Delegated execution protocol (opt-in)

By default the orchestrator executes tasks alone. **Delegates** are optional host workers (subagent, tmux session, etc.) that implement or review **one task** while the orchestrator and Kyro CLI keep ownership of `sprint.json`.

| Layer | Behavior |
|-------|----------|
| **L0** | Modes stay slim routers; full protocol is lazy-loaded from `helpers/delegated-execution.md` when the user or orchestrator opts in per task — no new CLI flags |
| **L1** | Personal `local.json` `execution.delegationEnabled` — `context-pack` surfaces `delegationEnabled`; modes load `delegated-execution.md` plus `delegates/implementer.md` or `delegates/checker.md` |
| **L2** | Host-specific launchers (e.g. tmux + agent CLI) — documented in `delegated-execution.md`; not part of core runtime |

| Aspect | Rule |
|--------|------|
| Unit of delegation | **Task** (`handoff.nextTaskId`) — not phase, sprint, or scope |
| Phase UX | "Run the phase with delegates" = orchestrator **loops** tasks; no delegate owns a phase |
| Default | Single-agent forge unchanged when delegation is off or unavailable |

**Write matrix:**

| Actor | May | Must not |
|-------|-----|----------|
| Orchestrator | Brief, spawn/skip worker, interpret status/findings, Kyro CLI, handoff | Give SoT ownership to a delegate |
| Delegate | Edit product code, run validation, return status or findings JSON | Mutate `sprint.json` / project layers; self-approve review |
| Kyro CLI | `record-evidence`, `review`, `plan`, `close-sprint`, … | — |

Enable L1: set `execution.delegationEnabled: true` in `.agents/kyro/local.json` (see [Teams](teams.md)). Briefs come from `kyro context-pack --task` (see [Context Management](context-management.md)). Checker separation: [Maker/Checker](maker-checker.md). **Usage in forge:** [Getting started — Delegated execution](getting-started.md#delegated-execution-optional). **End-to-end diagrams (scope → sprint → task → delegate → review):** [Delegation flow](delegation-flow.md).

| Skill | Knowledge Domain |
|-------|-----------------|
| `sprint-forge` | Core orchestration: modes, helpers, templates, gates, sprint.json read/write |
| `qa-review` | Senior QA audit, architecture validation, security review, sprint alignment |

---

## Data Flow

```
USER
  |
  v
/kyro:forge
  |
  v
ORCHESTRATOR
  |-- loads layered project state (project.json + local.json)
  |-- reads scoped sprint.json
  |-- reads sprint-forge skill assets
  |-- runs built-in checkpoints
  |
  v
.agents/kyro/scopes/{scope}/
  |-- sprint.json
  |-- archive/
  |-- findings/
```

### Flow for `/kyro:forge`

1. **Routing** - Orchestrator reads layered project state (`.agents/kyro/project.json` + `local.json`), then the scope's `sprint.json`, and routes on `handoff.nextAction`.
2. **Analysis** - Orchestrator explores the codebase and writes finding files under `findings/`.
3. **Gate 1** - User approves analysis.
4. **Planning** - Orchestrator materializes the objective, roadmap, and active sprint into `sprint.json` via `kyro plan --from` (tool-owned; init and sprint modes).
5. **Gate 2** - User approves the plan.
6. **Implementation** - Orchestrator executes tasks, then records evidence and the checker verdict through tool-owned verbs (`kyro record-evidence`, `kyro review`) rather than hand-editing `sprint.json`.
7. **Gate 3** - User approves implementation.
8. **Review and Close** - Orchestrator records debt changes with `kyro debt`, runs retro, and closes the sprint with `kyro close-sprint` — writing a verbatim snapshot plus a human narrative to `archive/`.

---

## Artifact Layout

Kyro keeps a single source of truth per scope: `sprint.json` holds the objective, success criteria, roadmap, the active sprint, debt, scope conventions, durable ADRs, and handoff routing. Shared `project.json.conventions[]` holds optional global operational rules inherited by every scope. Agents read layered project state and `sprint.json` first, then route state changes through Kyro's tool-owned verbs (`kyro plan`, `record-evidence`, `review`, `rule`, `debt`, `add-emergent`, `close-sprint`). See [Cost Model](cost-model.md) and [Teams](teams.md).

```
.agents/kyro/
├── project.json                 # shared — commit
├── local.json                   # personal — gitignored
├── .gitignore                   # install/sync local-only assist
└── scopes/
    └── {scope}/
        ├── sprint.json          # single source of truth
        ├── archive/             # write-only, at sprint close
        │   ├── sprint-001-slug.checkpoint.json # versioned lossless scope checkpoint
        │   ├── sprint-001-slug.json  # legacy verbatim ActiveSprint snapshot
        │   └── sprint-001-slug.md    # human narrative
        └── findings/            # write-only INIT analysis evidence
```

`{scope}` is the work topic in kebab-case, for example `oauth-implementation` or `ui-redesign`.

The output directory path (`{output_kyro_dir}`) is resolved once at the start of any mode and recorded in the scope's `sprint.json` under `handoff`. That file is the source of truth for the path.

### Scope-local ADRs

Architectural Decision Records live in `sprint.json.adrs[]`; Kyro does not create markdown ADR files or expose a separate ADR command in this version.

| Field | Contract |
|-------|----------|
| `id` | Stable `ADR-0001` style identifier, unique within the scope |
| `status` | `proposed`, `accepted`, `rejected`, or `superseded` |
| `context`, `decision`, `consequences`, `alternatives` | Required decision narrative and tradeoffs |
| `links` | Optional links to tasks, debt, conventions, docs, related ADRs, or superseded ADRs |

Use `conventions[]` for operational learned rules from retros and corrections. Use `adrs[]` for durable architectural decisions that need context, tradeoffs, and long-term reviewability. `kyro context-pack` includes ADRs for agent routing context, `kyro status full` summarizes them for humans/scripts, and `kyro doctor --artifacts` validates malformed ADR records.

---

## Built-In Checkpoints

The orchestrator runs checkpoints at lifecycle moments:

| Checkpoint | Purpose |
|------------|---------|
| startup | Load rules and detect active sprint state |
| pre-phase | Validate state before a phase starts |
| rule check | Verify relevant learned rules |
| post-edit scan | Detect debug artifacts and likely secrets |
| task complete | Verify task status and record compact evidence |
| pre-commit | Run configured quality gates |
| learn capture | Propose new rules from corrections |

---

## How the Workflow Differs from v1.x

Kyro v2.0 is a full workflow that replaces the v1.x single-skill approach.

```
v1.x: User message -> sprint-forge skill -> markdown artifacts

v2.0: User command -> orchestrator
                    -> sprint-forge / qa-review skills
                    -> built-in checkpoints
                    -> sprint.json
```

| Dimension | v1.x | v2.0 |
|-----------|------|------|
| Type | Single skill | Full workflow with commands, one agent, skills, and checkpoints |
| Entry point | Text triggers | Slash commands |
| Learning | Per-project retro only | Persistent conventions and debt tracked in `sprint.json` |
| Agent | Skill-only execution | Orchestrator |
| Quality gates | Basic | Per-task checklist + approval gates |
| Context transfer | None | `sprint.json` `handoff` field carries next-action routing across sessions |
| State model | Markdown artifacts | Single `sprint.json` per scope + write-only `archive/`/`findings/` |

---

## Component Map

| Component | Location |
|-----------|----------|
| Commands | `commands/` |
| Orchestrator | `agents/orchestrator.md` |
| Sprint workflow skill | `internal/skills/sprint-forge/` |
| QA review skill | `internal/skills/qa-review/` |
| Templates | `internal/skills/sprint-forge/assets/templates/` |
| Scope rules | `{scope}/sprint.json.conventions[]`, written by `kyro rule add` |
| Global rules | `.agents/kyro/project.json.conventions[]`, written by `kyro rule add --global` |
