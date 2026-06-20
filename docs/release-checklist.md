# Kyro AI Release Checklist

This checklist is for maintainers who cut releases of `kyro-ai`. It documents the generated artifact policy and the exact order of release gates so that stale `dist/` or adapter regressions cannot be published.

## Generated artifact policy

- `dist/` is a **generated artifact**. It is produced from `src/` by `npm run build`.
- The committed or packed `dist/` must always match a fresh build from the current `src/`.
- `npm run check:dist` enforces this by building `dist/` into a temporary directory and comparing it byte-for-byte with the existing `dist/`.
- `npm run check:adapters` enforces adapter projection behavior against the built runtime.
- `npm pack --dry-run` must run only after both gates pass.

## Release gate ordering

Run these commands in order. Any failure stops the release.

```bash
# 1. Fast static checks (typecheck, version sync, link check, dist freshness)
npm run check

# 2. Regenerate the runtime from source
npm run build

# 3. Adapter fixture validation against the regenerated runtime
npm run check:adapters

# 4. Token budget and artifact integrity checks
npm run check:tokens
npm run check:artifacts
npm run check:artifact-fixtures

# 5. Simulate packaging with fresh, validated output
npm pack --dry-run
```

### Why this order matters

1. `npm run check` includes `check:dist`, which proves the committed `dist/` matches current `src/` before any build overwrites it.
2. `npm run build` regenerates `dist/` from `src/`.
3. `npm run check:adapters` validates adapter behavior against the freshly built runtime.
4. Token/artifact checks confirm runtime-related budget and integrity constraints.
5. `npm pack --dry-run` simulates the published tarball only after all earlier gates succeed.

## CI behavior

The GitHub Actions `validate` job runs the same sequence:

```yaml
npm run check
npm run build
npm run check:adapters
npm run check:tokens
npm run check:artifacts
npm run check:artifact-fixtures
npm pack --dry-run
```

Only when `validate` succeeds does CI create a tag, publish to npm, and create a GitHub release.

## Local publish safety net

`package.json` defines:

```json
"prepublishOnly": "npm run build && npm run check:dist && npm run check:adapters"
```

This means a local `npm publish` also rebuilds, proves freshness, and validates adapters before the tarball is created. You can still run `npm pack --dry-run` to inspect the tarball without publishing.

## Before committing

- [ ] `npm run check` passes.
- [ ] `npm run build` produces no unexpected changes in `dist/`.
- [ ] `npm run check:adapters` passes.
- [ ] `npm pack --dry-run` succeeds.
- [ ] `npm run check:links` passes.

## Notes

- Do not edit `dist/` files by hand. Always change `src/` and regenerate with `npm run build`.
- If `check:dist` fails, run `npm run build` and inspect the diff in `dist/` before committing.
- Adapter fixture failures usually mean a projection in `src/cli/adapters/` or a command in `src/cli/commands/` changed without updating the corresponding fixture expectations.
