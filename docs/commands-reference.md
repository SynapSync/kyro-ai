# Commands Reference

Kyro provides 5 slash commands, most of them thin routers over the single source of truth: each reads structured state first, then loads only the mode/helper/template required for the current action. `/kyro:idea` is an optional **pre-scope** step that runs before any scope or `sprint.json` exists — it never reads or creates project state, and going straight to `/kyro:forge` without it is equally valid. `/kyro:qa` is an independent **certification audit** that can be run anytime to validate a scope against its specification, standing outside the forge gate lifecycle.

## Cost-Aware Routing

Kyro command paths are audited by `kyro doctor --tokens`. Brief status never opens sprint Markdown when summaries exist; forge execution never loads planning, debt, or re-entry helpers by default; closeout is the normal materialization point for full documentation.

For scope resume outside slash commands, use `kyro context-pack --kyro-scope <scope>` to emit the same summary-first routing bundle that agents would otherwise assemble manually.

---

## /kyro:idea

**Mature a rough or developed idea into an evidence-grounded, execution-ready plan. Optional and pre-scope.**

### Syntax

```
/kyro:idea <idea or reference>
```

### What it does

Seedbed automatically selects a `rough` discovery lane or a `mature` critical-synthesis lane. It may read references supplied by the user and explicitly relevant project evidence, but it never reads or mutates Kyro scope state. It classifies claims as evidence, outcomes, invariants, decisions, constraints, hypotheses, or unknowns; asks one material question at a time; and never repeats facts already grounded in evidence.

Before persistence it builds a causal thesis, observable success and failure guarantees, outcome boundaries, decision rationale, failure modes, an ordered execution blueprint, and an acceptance matrix. A deterministic 100-point rubric requires at least 90 points and no unresolved material contradiction. The command confirms the path, writes one document, then re-reads that document to validate it.

Repository `check:seedbed` is a deterministic structural contract test: it validates the canonical classifier, assertion vocabulary, routing markers, compatibility mappings, and eight adversarial scenario fixtures. It does not execute or score model-generated documents; comparative model-quality benchmarking remains a separate manual or evaluation-harness activity.

```
.agents/kyro/{docType}/{date}-{slug}.md
```

`docType` is `plan` by default, `analysis` for viability/comparison without a build commitment, or `constitution` for durable project rules. The public path and legacy frontmatter remain stable.

### Routing and safety

`/kyro:idea` bypasses the orchestrator and loads `skills/seedbed/assets/modes/idea.md` directly. It must not read or modify layered project state (`.agents/kyro/project.json`, `local.json`), `.agents/kyro/scopes/`, any `sprint.json`, secrets, or installed runtime state. User-provided documents and authorized read-only source, tests, schemas, manifests, docs, and history are valid grounding sources.

### After maturing

The resulting artifact can seed `/kyro:forge` or serve directly as an implementation handoff. INIT consumes its extended plan-grade sections when available and falls back to the legacy `Problem / Motivation`, `Who it's for`, and `What success looks like` headings for older briefs.

---

## /kyro:forge

**Full sprint cycle: Analyze, Plan, Implement, Review, Close.**

### Syntax

```
/kyro:forge <project path or description>
```

### Arguments

The argument describes what to analyze or work on. It can be a path, a module name, or a description of the work.

### Examples

```
/kyro:forge analyze the authentication module
/kyro:forge audit code quality in src/api/
/kyro:forge refactor the persistence layer
/kyro:forge add user profile feature
/kyro:forge fix the login timeout bug
```

### Routing

`/kyro:forge` starts with layered project state (`.agents/kyro/project.json` + `local.json`), then the scope's `sprint.json` when a scope exists. It routes on `sprint.json.handoff.nextAction` to exactly one mode:

```text
no roadmap       -> INIT.md
no active sprint -> plan-sprint.md
pending tasks    -> execute-task.md
validation       -> review-task.md
closeout         -> close-sprint.md
inconsistent     -> recover.md
```

Gates still apply at orchestrator-defined checkpoints, but the command file does not duplicate the full lifecycle.

### Gate Options

At each gate, the orchestrator presents a summary and waits for your decision:

| Option | Effect |
|--------|--------|
| `proceed` | Continue to the next phase |
| `adjust` | Modify the output before continuing (describe what to change) |
| `cancel` | Stop the workflow |

### Delegated execution (opt-in)

No separate `/kyro:delegate` command. During `execute_task` or `review_task`, the orchestrator may spawn a **host subagent** for one task while Kyro CLI ownership stays with the orchestrator.

| Activation | How |
| ---------- | --- |
| **L1** | `execution.delegationEnabled: true` in `.agents/kyro/local.json` — `context-pack` exposes `delegationEnabled` |
| **L0** | Ask in chat: e.g. "Execute T1.1 with delegate implementer" |

Example (L1 on — delegation automatic for each task):

```text
/kyro:forge
Continue scope my-scope. Execute task T1.1.
```

Example (L0 — explicit per task):

```text
/kyro:forge
Scope: my-scope — run T1.1 with delegates/implementer.md; you record-evidence and review.
```

Step-by-step guide: [Getting started — Delegated execution](getting-started.md#delegated-execution-optional).

### Orchestrator Protocols

- **Command router** -- chooses the next mode from structured state
- **Analysis protocol** -- INIT mode, read-only exploration
- **Review checklist** -- review-task mode and closeout
- **Debug protocol** -- execution failure recovery
- **orchestrator** -- coordinates gates and phase transitions

---

## /kyro:status

**Project progress, sprint state, and technical debt summary.**

### Syntax

```
/kyro:status [brief|full|debt]
```

### Variants

| Variant | What It Shows |
|---------|---------------|
| `brief` | Sprint progress bars and next sprint preview only |
| `full` | Complete report with all sections (default) |
| `debt` | Technical debt table and aged debt items |

### Examples

```
/kyro:status                # Full report
/kyro:status brief          # Quick progress check
/kyro:status debt           # Focus on technical debt
```

### Report Sections

The full report includes:

```
KYRO -- Project Status

## Sprint Progress
Sprint 1: xxxxxxxxxx 10/10 (100%)  Complete
Sprint 2: xxxxxxxx--  8/10 ( 80%)  Complete
Sprint 3: xxxxxxx--- 7/10 ( 70%)  In Progress

## Technical Debt
- Open: 4
- In progress: 1
- Aged: 2
- Critical: 1

## Roadmap Health
- Sprints completed: 2/5
- Roadmap adaptations: 1
- Carry-over tasks: 3

## Next Sprint Preview
Sprint 4: [title]
- Suggested phases: [count]
- Carry-over tasks: [count]
- Critical debt items due: [count]
```

### Data Sources

The status command reads structured state first:
- layered project state (`.agents/kyro/project.json` + `local.json`) for registry and the active scope
- `{scope}/sprint.json` for roadmap, active sprint progress, and debt

All metrics come directly from `sprint.json` fields — there are no separate summary files to keep in sync.

---

## /kyro:task-context

**Generate a copy-paste prompt for continuing Kyro work in a fresh context.**

Reads the active scope, `kyro context-pack`, the current git status, and referenced task/sprint artifacts. It is read-only: it returns one fenced prompt and does not mutate `sprint.json`.

---

## /kyro:qa

**Certify a scope's implementation and planning against its full specification.**

### Syntax

```
/kyro:qa [scope-name]
```

### Arguments

Optional scope name. If omitted, the active scope from `local.json.activeScope` is used, or you are prompted to select from available scopes.

### What it does

Runs a complete audit of code, architecture, security, testing, and planning artifacts against the scope's specification. The review validates:

- Functional correctness (does it satisfy the task spec?)
- Architecture alignment (follows project patterns?)
- Security (credentials, injections, authorization?)
- Code quality (clear, maintainable, free of unnecessary debt?)
- Testing (sufficient coverage and validation?)
- Reliability (error cases handled, failure modes make sense?)
- Performance (N+1 queries, unbounded operations, scaling issues?)
- Planning synchronization (`sprint.json`, roadmap, task verdicts, handoff in sync with code?)

### Verdict Scale

The review produces one of four verdicts:

| Verdict | Meaning |
|---------|---------|
| `APPROVED` | Implementation is correct and ready to ship/merge |
| `APPROVED WITH NOTES` | Acceptable with non-blocking recommendations |
| `CHANGES REQUIRED` | Close but needs fixes before approval |
| `REJECTED` | Does not meet standards; requires redesign |

**Important:** These are QA report conclusions. They do not get written into `sprint.json` task verdicts (which use a binary `pass`/`fail` schema for `/kyro:forge`'s gate system). The QA verdict is independent and complementary.

### Routing

`/kyro:qa` bypasses the orchestrator entirely — it does not load `agents/orchestrator.md` and stands outside the forge gate lifecycle. It can be run anytime: during active sprints, after completion, or as a one-off validation check.
