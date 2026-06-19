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

## Validation

```bash
npm run build
npm run check
npm run check:adapters
npm_config_cache=/tmp/kyro-npm-cache npm pack --dry-run
```

Additional smoke coverage was run with an isolated `HOME` and workspace under `/tmp`, covering install, doctor, sync dry-run, prune dry-run, uninstall, purge, and host binary detection for OpenCode and Codex.

## Notes

`doctor --adapters` now treats the global runtime as the files under `~/.agents/kyro/`. Adapter entrypoints are validated through installed adapter projection checks, so purging adapter assets after uninstall does not make the preserved global runtime appear broken.
