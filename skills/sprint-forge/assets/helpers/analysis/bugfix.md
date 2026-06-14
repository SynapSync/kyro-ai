# Bugfix Analysis

Use for broken behavior, regressions, or incorrect outputs.

## Inspect

1. Reproduce or restate the failure precisely.
2. Trace the failing path from input to output.
3. Identify root cause and blast radius.
4. Search for the same pattern in nearby code.
5. Find the narrowest verification that proves the fix.

## Findings

Document root cause, affected files, reproduction, expected behavior, proposed fix, and tests.

## Sizing signals

Use one sprint for localized fixes. Split only when reproduction, infrastructure, migration, or broad duplicated patterns require independent proof.
