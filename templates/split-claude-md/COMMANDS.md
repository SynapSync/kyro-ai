# COMMANDS.md — Kyro Command Reference

## /kyro-workflow:forge

Full sprint cycle: Analyze -> Plan -> Implement -> Review -> Commit.

```
/kyro-workflow:forge <project path or description>
```

Delegates to the orchestrator agent, which coordinates explorer, reviewer,
and debugger agents through validation gates. Each gate requires explicit
user approval before proceeding to the next phase.

## /kyro-workflow:sprint

Generate and/or execute the next sprint.

```
/kyro-workflow:sprint                    # Generate sprint from roadmap + previous retro
/kyro-workflow:sprint execute            # Execute the current sprint plan
/kyro-workflow:sprint status             # Show current sprint progress
```

Loads the roadmap, previous sprint retro, and outstanding debt to build
a new sprint plan. If a sprint is already in progress, resumes execution.

## /kyro-workflow:status

Project metrics, velocity trends, and debt heatmap.

```
/kyro-workflow:status                    # Full project status
/kyro-workflow:status velocity           # Velocity chart (last 5 sprints)
/kyro-workflow:status debt               # Debt heatmap by file/module
```

Shows completion rates, estimation accuracy, and highlights areas with
accumulated technical debt.

## /kyro-workflow:debt

Technical debt management.

```
/kyro-workflow:debt                      # List all open debt items
/kyro-workflow:debt add <description>    # Record a new debt item
/kyro-workflow:debt resolve <id>         # Mark a debt item as resolved
/kyro-workflow:debt defer <id>           # Defer to next sprint with justification
```

Debt items are never silently dropped. Items aged beyond 3 sprints are
flagged as critical and surfaced prominently in `/kyro-workflow:status`.

## /kyro-workflow:retro

Sprint retrospective ritual. Required after every completed sprint.

```
/kyro-workflow:retro                     # Run retrospective for the current sprint
```

Captures: what worked, what did not, estimation accuracy, and concrete
improvements. Writes learnings to `LEARNED.md` and to the project rules
file at `.agents/kyro/rules.md`.

---

## Project-Specific Overrides

Add custom command behavior or aliases below. These take precedence
over the defaults above.

<!-- Example: -->
<!-- /kyro-workflow:forge always runs with --parallel when on a feature branch -->
<!-- /kyro-workflow:sprint max tasks = 5 for this project (smaller scope) -->
