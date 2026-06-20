---
title: "CI does not enforce adapter fixture coverage"
date: "2026-06-19"
scope: "00-p0-reproducibility-and-ci"
type: "finding"
status: "open"
severity: "high"
tags: [ci, adapters, validation, p0]
---

# CI does not enforce adapter fixture coverage

## Summary

The repository has an adapter fixture script, but CI does not run `npm run check:adapters` in the validation job.

## Evidence

- `package.json` defines `check:adapters` as `node scripts/check-adapter-fixtures.mjs`.
- `.github/workflows/ci.yml` runs `npm run check`, `npm run build`, `npm run check:tokens`, `npm run check:artifacts`, `npm run check:artifact-fixtures`, and `npm pack --dry-run`.
- `.github/workflows/ci.yml` does not run `npm run check:adapters`.
- Source backlog: `.agents/kyro/strategic-audit-2026-06-19/backlogs/00-p0-reproducibility-and-ci.md`.

## Affected Files

- `.github/workflows/ci.yml`
- `package.json`
- `scripts/check-adapter-fixtures.mjs`

## Impact

Adapter projection regressions can escape CI, especially for `doctor --adapters`, native command projections, and planned/implemented adapter inventory behavior.

## Recommendation

Add adapter fixture validation after build in CI, and make package dry-run happen after reproducibility checks.

## Validation

```bash
npm run build
npm run check:adapters
npm pack --dry-run
```
