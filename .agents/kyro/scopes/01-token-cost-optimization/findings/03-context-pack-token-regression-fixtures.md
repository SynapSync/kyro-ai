# Finding 03 — Context-pack token budgets need regression fixtures

## Summary
`doctor --tokens` now audits runtime paths, but generated context packs need their own fixtures and budget checks.

## Severity
P1/P2 — prevents cost regressions after the command lands.

## Affected files or modules
- `fixtures/context-pack/**` (new)
- `scripts/check-context-pack-fixtures.mjs` (new)
- `package.json`
- `src/cli/commands/token-audit.ts`
- `src/cli/commands/context-pack.ts`

## User-visible behavior
Maintainers should know when a context-pack change causes brief/status/task packs to exceed intended budgets before publishing.

## Details
Runtime path budgets cover eager instruction loading. Context-pack output can still grow over time if fixtures do not lock expected size and sections.

## Recommendation
Add golden fixtures for brief scope pack and active task pack. Track section-level estimated words/tokens and fail when budgets regress without an explicit fixture update.

## Validation
- `npm run check:context-pack-fixtures`.
- `npm run check:tokens` includes context-pack budget summary or references the fixture checker.
