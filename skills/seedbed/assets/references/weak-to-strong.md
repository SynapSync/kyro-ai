# Weak-to-Strong Transformations

Use these patterns to deepen reasoning without copying their domain.

## Description to thesis

**Weak:** "Build a dashboard that shows workflow data."

**Strong:** "Operational trust is the product: every displayed state must be traceable to canonical workflow evidence, because an attractive but stale dashboard causes users to make incorrect delivery decisions."

## Desired behavior to falsifiable guarantee

**Weak:** "Handle missing data gracefully."

**Strong:** "When canonical data is absent, show an explicit empty state naming the missing source; never substitute samples or stale values. Prove it with fixtures for absent, partial, and malformed inputs."

## Technical choice to decision reasoning

**Weak:** "Use a local parser."

**Strong:** "Parse locally to preserve read-only operation and offline availability. Accept duplicated parsing cost in the first slice; reject runtime mutation or network dependence because either would violate the trust invariant."

## Task list to execution blueprint

**Weak:** "Create parser, UI, and tests."

**Strong:** "First establish canonical field semantics with fixtures; gate on deterministic extraction. Then expose a read-only application boundary; gate on partial-failure behavior. Only then build presentation against that boundary and prove every displayed state maps to fixture evidence."

The stronger form adds causality, invariant, tradeoff, order, and proof. Do not add volume that lacks those properties.
