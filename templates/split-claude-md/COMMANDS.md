# COMMANDS.md — Kyro Command Reference

## /kyro-workflow:forge

Full sprint cycle: Analyze -> Plan -> Implement -> Review -> Commit.

```
/kyro-workflow:forge <project path or description>
```

Delegates to the orchestrator agent, which coordinates analysis, review,
and debug protocols through validation gates. Each gate requires explicit
user approval before proceeding to the next phase.

## /kyro-workflow:status

Project metrics, velocity trends, and debt heatmap.

```
/kyro-workflow:status                    # Full project status
/kyro-workflow:status velocity           # Velocity chart (last 5 sprints)
/kyro-workflow:status debt               # Debt heatmap by file/module
```

Shows completion rates, estimation accuracy, and highlights areas with
accumulated technical debt.

---

## Project-Specific Overrides

Add custom command behavior or aliases below. These take precedence
over the defaults above.

<!-- Example: -->
<!-- /kyro-workflow:forge always runs with --parallel when on a feature branch -->
<!-- /kyro-workflow:forge max tasks = 5 for this project (smaller scope) -->
