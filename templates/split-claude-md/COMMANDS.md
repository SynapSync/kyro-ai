# COMMANDS.md — Kyro Command Reference

## /forge

Full sprint cycle: Analyze -> Plan -> Implement -> Review -> Commit.

```
/forge <project path or description>
```

Delegates to the orchestrator agent, which coordinates explorer, reviewer,
and debugger agents through validation gates. Each gate requires explicit
user approval before proceeding to the next phase.

## /sprint

Generate and/or execute the next sprint.

```
/sprint                    # Generate sprint from roadmap + previous retro
/sprint execute            # Execute the current sprint plan
/sprint status             # Show current sprint progress
```

Loads the roadmap, previous sprint retro, and outstanding debt to build
a new sprint plan. If a sprint is already in progress, resumes execution.

## /status

Project metrics, velocity trends, and debt heatmap.

```
/status                    # Full project status
/status velocity           # Velocity chart (last 5 sprints)
/status debt               # Debt heatmap by file/module
```

Shows completion rates, estimation accuracy, and highlights areas with
accumulated technical debt.

## /debt

Technical debt management.

```
/debt                      # List all open debt items
/debt add <description>    # Record a new debt item
/debt resolve <id>         # Mark a debt item as resolved
/debt defer <id>           # Defer to next sprint with justification
```

Debt items are never silently dropped. Items aged beyond 3 sprints are
flagged as critical and surfaced prominently in `/status`.

## /retro

Sprint retrospective ritual. Required after every completed sprint.

```
/retro                     # Run retrospective for the current sprint
```

Captures: what worked, what did not, estimation accuracy, and concrete
improvements. Writes learnings to `LEARNED.md` and to the global rules
file at `~/.kyro/rules.md`.

---

## Project-Specific Overrides

Add custom command behavior or aliases below. These take precedence
over the defaults above.

<!-- Example: -->
<!-- /forge always runs with --parallel when on a feature branch -->
<!-- /sprint max tasks = 5 for this project (smaller scope) -->
