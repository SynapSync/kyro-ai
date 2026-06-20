# Backlog: P0 Reproducibility and CI

Kyro is a harness. If source, generated runtime, and published package can drift, every higher-level optimization becomes suspect. This backlog fixed the trust foundation first and is now complete as of 2026-06-20.

## Completion status

**Status:** DONE. Verified on 2026-06-20 with `npm run check`, `npm run check:adapters`, `npm run check:tokens`, `npm run check:artifacts`, `npm run check:artifact-fixtures`, and `npm pack --dry-run`. `kyro-ai@3.4.2` is published. Historical evidence below explains why this scope existed.

## Historical evidence

- `src/cli/options.ts` supports `--adapters`, `--json`, `--prune`, and `--purge-adapter-assets`.
- Current committed `dist/cli/options.js` did not support `--adapters` during the audit.
- `node dist/cli.js doctor --adapters` failed with `Unknown option: --adapters`.
- `npm run check:adapters` failed before rebuild.
- A temporary copy passed `npm run build && npm run check:adapters`.
- `.github/workflows/ci.yml` did not run `npm run check:adapters`.

## Technical correction

Treat `dist/` as a generated artifact that must be fresh whenever committed or packed. CI should prove the checked-in runtime matches source and adapter fixtures pass against built output.

## Tasks

| ID | Priority | Size | Task | Likely files | Acceptance criteria | Validation |
|----|----------|------|------|--------------|---------------------|------------|
| REP-001 | DONE | S | Rebuild and commit fresh `dist/` from current `src/` | `dist/**` | `dist/` includes generated files for current source modules such as `detect`, `preflight`, `drift`, injectors, and pipeline | `npm run build`, `npm run check:dist` |
| REP-002 | DONE | M | Add `check:dist` script that fails when build changes committed `dist/` | `package.json`, `scripts/check-dist-freshness.mjs` | Script compares generated output in a temp directory and exits non-zero on drift | `npm run check:dist` |
| REP-003 | DONE | S | Add adapter fixture validation to CI after build | `.github/workflows/ci.yml` | CI runs `npm run check:adapters` after `npm run build` | CI validate job |
| REP-004 | DONE | S | Add package dry-run after dist freshness and adapter checks | `.github/workflows/ci.yml`, `package.json` | `npm pack --dry-run` runs after validation | `npm pack --dry-run` |
| REP-005 | DONE | S | Document generated artifact policy | `docs/cli.md`, `README.md`, `docs/release-checklist.md` | Maintainers know when `dist/` must be committed and how to verify it | Markdown link check |

## Out of scope

- Do not redesign build tooling.
- Do not remove `dist/` from the package unless a separate release strategy is approved.
- Do not introduce a bundler just to solve freshness.
