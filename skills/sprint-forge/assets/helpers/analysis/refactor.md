# Refactor Analysis

Use for structural changes that preserve intended behavior.

## Inspect

1. Identify the behavior that must remain stable.
2. Map coupling, ownership boundaries, and current tests.
3. Find the smallest safe sequence of changes.
4. Note compatibility or migration constraints.

## Findings

Document current structure, target structure, affected modules, risks, and verification gates.

## Sizing signals

Split when a foundation must land before consumers, when compatibility must be preserved, or when review units would otherwise mix unrelated concerns. Keep as one sprint for local cleanups with strong tests.
