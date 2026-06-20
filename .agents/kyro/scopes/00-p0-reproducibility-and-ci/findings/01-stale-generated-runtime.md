---
title: "Stale generated runtime can diverge from source"
date: "2026-06-19"
scope: "00-p0-reproducibility-and-ci"
type: "finding"
status: "open"
severity: "critical"
tags: [reproducibility, dist, runtime, p0]
---

# Stale generated runtime can diverge from source

## Summary

The committed `dist/` output can drift from `src/`, causing the installed or packed Kyro runtime to behave differently from the TypeScript source.

## Evidence

- `src/cli/options.ts` supports flags such as `--adapters`, `--json`, `--prune`, and `--purge-adapter-assets`.
- The strategic audit found `node dist/cli.js doctor --adapters` failing with `Unknown option: --adapters`.
- Current source search finds adapter inventory, detect, and preflight behavior in `src/`, while the checked `dist/cli/options.js` does not expose matching adapter parsing content.
- Source backlog: `.agents/kyro/strategic-audit-2026-06-19/backlogs/00-p0-reproducibility-and-ci.md`.

## Affected Files

- `dist/**`
- `src/cli/**`
- `package.json`
- `scripts/check-adapter-fixtures.mjs`

## Impact

For a workflow harness, source/runtime drift is a trust failure. Agents and users may validate source behavior while actually installing stale generated JavaScript.

## Recommendation

Rebuild and commit fresh `dist/` as an isolated first sprint, then verify `node dist/cli.js doctor --adapters` and adapter fixture behavior.

## Validation

```bash
npm run build
node dist/cli.js doctor --adapters
npm run check:adapters
```
