---
title: "Generated artifact policy is not explicit enough"
date: "2026-06-19"
scope: "00-p0-reproducibility-and-ci"
type: "finding"
status: "open"
severity: "medium"
tags: [release, docs, generated-artifacts, maintainability]
---

# Generated artifact policy is not explicit enough

## Summary

The project needs a maintainer-facing generated artifact policy explaining when `dist/` must be rebuilt, committed, checked, packed, and documented.

## Evidence

- `prepublishOnly` runs `npm run build`, but local `npm pack --dry-run` can still inspect stale checked-in `dist/` unless a build happened first.
- The audit identified stale checked-in `dist/` as a P0 trust issue.
- Existing docs describe CLI/runtime behavior, but there is no focused generated artifact/release checklist for maintainers.
- Source backlog: `.agents/kyro/strategic-audit-2026-06-19/backlogs/00-p0-reproducibility-and-ci.md`.

## Affected Files

- `docs/cli.md`
- `README.md`
- `docs/release-checklist.md` or equivalent
- `package.json`

## Impact

Without explicit policy, future contributors can repeat the same source/runtime drift and publish or validate misleading package contents.

## Recommendation

Document the generated artifact policy after technical checks exist, including exact commands and release gate ordering.

## Validation

```bash
npm run check:links
npm run check:dist
npm run check:adapters
npm pack --dry-run
```
