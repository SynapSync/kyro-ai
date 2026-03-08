---
description: Manage and review technical debt
argument-hint: [list|add|resolve|escalate]
---

# /debt — Technical Debt Management

View, add, resolve, or escalate technical debt items across sprints.

## Action: $ARGUMENTS

### List

Display the full accumulated technical debt table:

```text
## Accumulated Technical Debt

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|---------------|--------|-------------|
| 1 | Missing auth middleware tests | INIT finding | Sprint 2 | resolved | Sprint 2 |
| 2 | Hardcoded API timeout values | Sprint 1 retro | Sprint 3 | in-progress | — |
| 3 | N+1 query in /api/users | Sprint 2 phase | Sprint 3 | open | — |
| 4 | Deprecated crypto.createCipher | INIT finding | Sprint 4 | open | — |
```

### Add

Add a new debt item:

```
/debt add "Missing error boundary in dashboard" --origin "Sprint 3 retro" --target "Sprint 4"
```

### Resolve

Mark a debt item as resolved:

```
/debt resolve 3 --sprint "Sprint 3"
```

### Escalate

Flag aged debt items (>3 sprints without resolution):

```
/debt escalate
```

Shows items that have been open for more than 3 sprints and asks:
- Should this become a dedicated sprint?
- Should the priority be increased?
- Is this still relevant or can it be closed as N/A?

### Rules

- Debt items are never deleted — only their status changes
- Every sprint inherits the full debt table from the previous sprint
- Items open for >3 sprints trigger the `DebtItemAged` hook automatically
- New debt discovered during execution gets added with origin "Sprint N phase"
