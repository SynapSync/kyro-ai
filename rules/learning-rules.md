---
description: Governs the capture, formatting, and lifecycle of learned rules in ~/.kyro/rules.md. Ensures rules are specific, actionable, and do not accumulate without bound.
globs: ["**/*.md"]
alwaysApply: true
---

# Learning Rules

Rules governing how Kyro captures and manages cross-project learnings.

## R-LR-01: Capture Corrections as Rules

When a correction is made during a sprint (user overrides a decision, a pattern causes a bug, an estimation is wrong), capture it as a rule.

Format:
```
[LEARN] <date> (<project>) — <specific, actionable rule>
```

Example:
```
[LEARN] 2026-01-15 (api-gateway) — Always check for null middleware before calling next() in Express error handlers
```

## R-LR-02: Rules Must Be Specific and Actionable

Rules must describe a concrete behavior to adopt or avoid. Vague rules are rejected.

- BAD: "Be more careful with error handling"
- GOOD: "Wrap all database calls in try/catch and log the query on failure"
- BAD: "Tests are important"
- GOOD: "Add integration tests for every new API endpoint before closing the task"

## R-LR-03: Include Provenance

Every rule must include the date it was learned and the project where the lesson originated.

- This enables filtering rules by recency and relevance.
- When applying rules to a new project, prioritize rules from similar project types.
- Rules without provenance are flagged for update during the next retro.

## R-LR-04: Check Before Adding

Before proposing a new rule, check `~/.kyro/rules.md` for existing rules that cover the same concern.

- If a match exists, update or refine the existing rule instead of adding a duplicate.
- If the new rule contradicts an existing one, present both to the user for resolution.
- Use the `kyro-learner` skill's search capability to find semantic matches.

## R-LR-05: Maximum 50 Active Rules

The active rule set must not exceed 50 rules.

- When the limit is reached, trigger a consolidation review:
  1. Merge rules that cover the same domain into a single, broader rule.
  2. Deprecate rules that have not been triggered in the last 5 sprints.
  3. Archive deprecated rules to `~/.kyro/rules-archive.md`.
- Present the consolidation plan to the user for approval before modifying.

## R-LR-06: Rule Application Tracking

Track which rules are applied during each sprint.

- Record rule applications in the sprint file's "Applied Rules" section.
- Rules that are consistently applied become candidates for automation (hooks or linting).
- Rules that are never triggered become candidates for deprecation.
