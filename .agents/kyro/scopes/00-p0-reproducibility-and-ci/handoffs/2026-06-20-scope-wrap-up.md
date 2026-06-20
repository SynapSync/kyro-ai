# Handoff — 00-p0-reproducibility-and-ci Scope Wrap-Up

Date: 2026-06-20
Scope: 00-p0-reproducibility-and-ci
Status: completed

## Scope State

- **Roadmap**: 3 sprints planned, 3 completed
- **Active sprint**: none
- **Open debt**: 0 (all 3 items resolved)
- **Next action**: `wrap_up` → scope is complete

## Completed Work

### Sprint 1 — Restore Generated Runtime Parity

- Rebuilt `dist/` from current `src/`.
- Verified `node dist/cli.js doctor --adapters`, `node dist/cli.js detect`, and `npm run check:adapters` pass.
- Recorded source/runtime drift evidence before and after the rebuild.

### Sprint 2 — Enforce Freshness and Adapter CI Gates

- Implemented `scripts/check-dist-freshness.mjs` and wired it into `npm run check`.
- Updated `.github/workflows/ci.yml` to run `npm run check:adapters` after `npm run build`.
- Ordered `npm pack --dry-run` after all reproducibility gates.

### Sprint 3 — Document Generated Artifact and Release Policy

- Created `docs/release-checklist.md` with exact gate ordering and generated artifact policy.
- Updated `docs/cli.md` with a "Maintenance Scripts" section.
- Added a "Generated Artifacts and Release Process" section to `README.md`.
- Hardened `package.json` `prepublishOnly` to run `build && check:dist && check:adapters`.
- Updated `docs/release-3.4.0.md` with a "Reproducibility and CI" section.

## Mental Context

### Decisions Made

- `check:dist` builds to a repo-root temp directory (`.kyro-dist-check-*`) so source-map `sources` paths match the committed `dist/` and the comparison is byte-for-byte.
- `prepublishOnly` includes only `build`, `check:dist`, and `check:adapters`; token/artifact checks remain in CI and local `npm run check`.
- Documentation references real commands verbatim to avoid drift between code and docs.

### Corrections Applied

- Fixed `scripts/check-dist-freshness.mjs` cleanup: `process.exit()` inside a `try` block skipped `finally`, so the script was refactored to a single exit point after cleanup.
- Fixed `index.json` `nextTask` values to be verbatim substrings of the active sprint Markdown so the artifact doctor passes.
- Fixed a relative link in `docs/release-3.4.0.md` (`docs/release-checklist.md` → `release-checklist.md`).

### Rules Established

- See `.agents/kyro/scopes/rules.md` for persistent rules on generated runtime, checks/CI, documentation, and sprint closure.

## Files Context

### Source / Config Changes

- `scripts/check-dist-freshness.mjs` — new deterministic dist freshness script.
- `package.json` — added `check:dist` script, updated `check` and `prepublishOnly`.
- `.github/workflows/ci.yml` — added `npm run check:adapters`, ordered gates before pack dry-run.

### Documentation Changes

- `docs/release-checklist.md` — new maintainer release checklist.
- `docs/cli.md` — documented `check:dist` and `check:adapters`.
- `README.md` — added generated artifacts / release process section.
- `docs/release-3.4.0.md` — added reproducibility and CI section.

### Kyro Artifacts Updated

- `.agents/kyro/scopes/00-p0-reproducibility-and-ci/state.json` — `status: completed`.
- `.agents/kyro/scopes/00-p0-reproducibility-and-ci/index.json` — no active sprint, no open debt.
- `.agents/kyro/scopes/00-p0-reproducibility-and-ci/ROADMAP.summary.json` — 3/3 sprints completed.
- `.agents/kyro/scopes/00-p0-reproducibility-and-ci/DEBT.summary.json` — 3 resolved, 0 open.
- `.agents/kyro/scopes/00-p0-reproducibility-and-ci/RE-ENTRY-PROMPTS.md` — scope completed.
- `.agents/kyro/scopes/00-p0-reproducibility-and-ci/rules.md` — added rules from all three sprints.

## Recommended Next Action

1. Review the uncommitted changes with `git status`.
2. Stage and commit the P0 reproducibility work.
3. Open a pull request for review.
4. After merge, consider starting the next Kyro scope or removing `00-p0-reproducibility-and-ci` from the active scope list if no further work is planned.

## Notes

- `.gitignore` has a pre-existing modification that was not touched during this work.
- All quality checks pass: `npm run check`, `npm run check:adapters`, `npm run check:artifacts`, `npm run check:artifact-fixtures`, and `npm pack --dry-run`.
