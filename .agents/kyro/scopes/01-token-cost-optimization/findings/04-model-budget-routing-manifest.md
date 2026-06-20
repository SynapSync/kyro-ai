# Finding 04 — Model and budget routing remains policy, not contract

## Summary
Kyro has route budgets, but it does not yet encode task categories into provider-neutral budget/model guidance.

## Severity
P2 — product and platform cost optimization.

## Affected files or modules
- `config.json`
- `src/cli/types.ts`
- `src/cli/commands/context-pack.ts`
- `docs/cost-model.md`
- `docs/context-management.md`

## User-visible behavior
Context packs should identify a budget class and suggested reasoning tier without naming provider-specific model IDs.

## Details
Users want Kyro to be rigorous without being expensive. A provider-neutral budget class lets adapters choose cheap/strong execution surfaces while preserving quality gates.

## Recommendation
Define budget classes such as `brief`, `execute`, `review`, and `close`, map them to token budgets and reasoning guidance, and include the selected budget class in context-pack output.

## Validation
- Schema/fixture test for budget manifest.
- Docs explain budget classes and tradeoffs.
- No provider-specific model names in core config.
