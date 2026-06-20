# Kyro AI 3.4.0 Release Notes

## Summary

Kyro 3.4.0 stabilizes the adapter harness v1 release. It adds concrete OpenCode and Codex adapter projections, keeps Claude plugin support first-class, and hardens sync/uninstall behavior around managed files, shared config, drift, prune, purge, and dry-run safety.

## Highlights

- Adapter harness v1 for `standard`, `opencode`, and `codex`.
- `kyro detect` and adapter inventory through `kyro doctor --adapters`.
- OpenCode native skills, `/kyro/*` command files, and a Kyro-owned `agent.kyro-orchestrator` overlay.
- Codex command skills plus a managed root `AGENTS.md` block.
- Global runtime under `~/.agents/kyro/versions/{version}` with `current` symlink.
- Project-local state under `.agents/kyro/`.
- `kyro sync` refreshes installed adapters without silently adding `standard`.
- `kyro sync --prune` removes stale runtime versions and obsolete Kyro-owned adapter entrypoints.
- Shared config such as `~/.config/opencode/opencode.json` is preserved and reported separately.
- `kyro uninstall --purge-adapter-assets` explicitly removes adapter entrypoints while preserving shared config.
- Dry-run behavior is covered for prune and purge paths.
- Pipeline rollback and managed block/JSON merge behavior are covered by fixtures.

## Non-Goals

- No generic adapter is provided.
- Cursor remains planned until concrete projection behavior is defined.
- Claude plugin support is not replaced by the CLI adapter path.
- MCP remains modeled but inactive until there is a concrete Kyro MCP server contract.

## Reproducibility and CI

This release hardens trust between source and generated runtime:

- **Restored generated runtime parity** — `dist/` is rebuilt from current `src/` so `kyro doctor --adapters`, `kyro detect`, and adapter preflight behavior match the TypeScript source.
- **Deterministic `check:dist` gate** — `npm run check:dist` builds `dist/` into a temporary directory and fails if it differs from the committed `dist/`, preventing source/runtime drift from being merged.
- **Adapter fixture validation in CI** — `.github/workflows/ci.yml` now runs `npm run check:adapters` after `npm run build` so adapter projection regressions cannot escape.
- **Package dry-run ordering** — `npm pack --dry-run` runs only after `check:dist`, `check:adapters`, token, and artifact checks succeed, so releases cannot pack stale or broken runtimes.
- **Local publish safety net** — `prepublishOnly` now runs `npm run build && npm run check:dist && npm run check:adapters`, matching the CI gates for local publishes.

## Validation

```bash
npm run check       # typecheck + versions + links + check:dist
npm run build
npm run check:adapters
npm run check:tokens
npm run check:artifacts
npm run check:artifact-fixtures
npm pack --dry-run
```

Additional smoke coverage was run with an isolated `HOME` and workspace under `/tmp`, covering install, doctor, sync dry-run, prune dry-run, uninstall, purge, and host binary detection for OpenCode and Codex.

## Notes

`doctor --adapters` now treats the global runtime as the files under `~/.agents/kyro/`. Adapter entrypoints are validated through installed adapter projection checks, so purging adapter assets after uninstall does not make the preserved global runtime appear broken.

For the full maintainer checklist, see [`docs/release-checklist.md`](release-checklist.md).
