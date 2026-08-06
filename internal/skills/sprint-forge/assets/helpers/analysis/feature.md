# Feature Analysis

Use for new user-visible behavior or capability changes.

## Inspect

1. Identify the public interface affected: command, API, UI, config, or artifact.
2. Trace the smallest existing path that owns similar behavior.
3. Read only the files needed to understand integration points, tests, and docs.
4. Capture risks from compatibility, persistence, validation, or missing tests.

## Findings

Write findings only for distinct implementation concerns. Do not split by task labels alone.

Each finding must include:

- summary
- affected files or modules
- user-visible behavior
- implementation recommendation
- validation approach

## Sizing signals

Multiple sprints are justified when the feature has a dependency chain, public interface change, reusable foundation, separate review units, or risk that should be proven independently.

One sprint is acceptable when the change is cohesive, low risk, and can be reviewed end-to-end safely.
