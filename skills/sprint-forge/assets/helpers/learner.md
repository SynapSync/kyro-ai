---
name: kyro-learner
description: >
  Captures corrections and patterns as persistent rules for this project.
  Manages .agents/sprint-forge/rules.md — the accumulated wisdom from sprint executions.
---

# Kyro Learner — Per-Project Rule Accumulation

## Purpose

Captures corrections, patterns, and estimation insights as persistent rules stored in `.agents/sprint-forge/rules.md`. These rules are project-scoped and accumulated across sprints.

## Rule Format

```markdown
# Kyro — Learned Rules

## Estimation
- [RULE-001] DB migration tasks: add 20% buffer to estimates (2026-02-20, project: nebux-api)
- [RULE-002] Auth tasks frequently reveal hidden dependencies (2026-02-22, project: nebux-api)

## Quality
- [RULE-003] Always validate version compatibility before adding dependencies (2026-02-25, project: synap-sync)

## Architecture
- [RULE-004] Extract shared validation logic before 3rd duplication (2026-03-01, project: skills-registry)

## Testing
- [RULE-005] E2E tests for auth flows catch integration issues that unit tests miss (2026-03-03, project: nebux-api)

## Process
- [RULE-006] Run full quality gates before closing sprint, not just per-task (2026-03-05, project: synap-sync)
```

## Capture Flow

When the user corrects the agent or a pattern is identified:

1. Detect the correction or pattern
2. Propose the rule in standard format:

```text
Detected a pattern worth remembering:

[RULE-XXX] Category: One-line rule
  Context: Why this rule exists
  Source: Sprint N, Project: project-name

Save this rule? (yes/no/edit)
```

3. On approval, append to `.agents/sprint-forge/rules.md`
4. Log in the sprint's LEARNED section

## Rule Application

At the start of every session:
1. Load `.agents/sprint-forge/rules.md`
2. Before generating sprint estimates, check estimation rules
3. Before architecture decisions, check architecture rules
4. If about to violate a rule, pause and show it (RuleViolation event)

## Rule Lifecycle

- **Active** — Applied automatically in relevant contexts
- **Deprecated** — User marks as no longer relevant (kept for history)
- **Evolved** — Updated rule replaces a previous version (link to original)

## Rules About Rules

- Never add duplicate rules. Check existing rules before proposing.
- Rules must be specific and actionable, not vague platitudes.
- Include the date and project where the rule was learned.
- Rules from corrections have higher confidence than proactive suggestions.
- Maximum 50 active rules. After that, consolidate or deprecate.
