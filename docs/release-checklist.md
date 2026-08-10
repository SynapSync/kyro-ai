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
# (includes check:layered-state + check:install-rehydrate for multi-dev project state)

# 2. Regenerate the runtime from source
npm run build

# 3. Adapter fixture validation against the regenerated runtime
npm run check:adapters

# 4. Token budget and artifact integrity checks
npm run check:tokens
npm run check:artifacts

# 5. Simulate packaging with fresh, validated output
npm pack --dry-run
```

### Multi-dev project state (layered)

Before claiming multi-developer readiness in release notes, confirm:

- `npm run check:layered-state` — merge, migrate, write targeting, status/context-pack no-write, doctor layered health
- `npm run check:install-rehydrate` — install writes `project.json` + `local.json`, gitignore assist, scope rehydrate
- Docs match the commit matrix (`project.json` + `scopes/**` committed; `local.json` gitignored) — see [Teams](teams.md)

### Why this order matters

1. `npm run check` includes `check:dist`, which proves the committed `dist/` matches current `src/` before any build overwrites it.
2. `npm run build` regenerates `dist/` from `src/`.
3. `npm run check:adapters` validates adapter behavior against the freshly built runtime.
4. Token/artifact checks confirm runtime-related budget and integrity constraints.
5. `npm pack --dry-run` simulates the published tarball only after all earlier gates succeed.

## CI behavior

The GitHub Actions `validate` job runs the same sequence:

```yaml
npm run build
npm run check
npm run check:adapters
npm run check:tokens
npm run check:artifacts
npm pack --dry-run
```

Validation also requires the package version to be absent from GitHub Releases, Git tags, and npm. This check runs on pull requests and pushes to `main`, so a reused version fails visibly with a required-bump error instead of skipping publication in an otherwise green run.

Only when `validate` succeeds on a push to `main` does CI create the matching tag, publish to npm, and create a GitHub release. Re-running a completed release without a new version is expected to fail.

## Local publish safety net

`package.json` defines:

```json
"prepublishOnly": "npm run build && npm run check:dist && npm run check:adapters"
```

This means a local `npm publish` also rebuilds, proves freshness, and validates adapters before the tarball is created. You can still run `npm pack --dry-run` to inspect the tarball without publishing.

## Before committing

- [ ] The version was bumped and does not already exist as a GitHub Release, Git tag, or npm version.
- [ ] `npm run check` passes.
- [ ] `npm run build` produces no unexpected changes in `dist/`.
- [ ] `npm run check:adapters` passes.
- [ ] `npm pack --dry-run` succeeds.
- [ ] `npm run check:links` passes.

## Notes

- Do not edit `dist/` files by hand. Always change `src/` and regenerate with `npm run build`.
- If `check:dist` fails, run `npm run build` and inspect the diff in `dist/` before committing.
- Adapter fixture failures usually mean a projection in `src/cli/adapters/` or a command in `src/cli/commands/` changed without updating the corresponding fixture expectations.

## Evidence boundaries

Six different things get called "it works". They are not interchangeable, and a release claim must
say which one it has. This project has already shipped a gate that passed against a synthetic
fixture while the real scope remained unrepairable, so these boundaries are enforced rather than
merely described.

| Evidence | What it proves | What it does **not** prove |
| --- | --- | --- |
| **Source checkout** (`node dist/cli.js`) | The code in this working tree behaves correctly. | That the package contains the files that behaviour needs. |
| **Packed tarball** (`npm pack`) | The archive builds and has the expected name/version. | That anything inside it runs. |
| **Temporary installed candidate** (tarball installed into a fresh temp prefix) | A user installing this exact artifact gets this exact behaviour. | That any *published* version does. |
| **Current global runtime** (`~/.agents/kyro/current`) | What users have installed **today**. | Anything about the candidate. Never overwrite it to "verify" a release. |
| **Kyro Lens** | An independent read-only verifier agrees with the artifacts. | That Kyro's own writes are correct beyond what Lens can re-derive. |
| **Publication** (npm, tags, GitHub release, remote CI) | The artifact is available to users. | Only CI on `main` establishes this. |

Rules that follow from the table:

- A green local matrix **authorizes a release decision; it does not authorize a publish.** It says
  nothing about npm, git tags, remote CI, or the runtime installed on this machine.
- **Never replace `~/.agents/kyro/current` to test a candidate.** Install the tarball into a
  temporary prefix instead. The global runtime is reported as a compatibility observation only.
- A candidate must be **distinguishable from what users already run.** If the candidate ships new
  operations, it must ship a new version; `check:original-incident-release` fails when an
  origin-only runtime and the candidate share a version string.
- **Lens results are read-only evidence.** Lens is never used to repair a scope, and a Lens run
  against a temporary copy says nothing about the original project it was copied from.

## Original-incident gate

```bash
# Source + packed tarball + temporary installed candidate, on the faithful legacy fixture.
npm run check:original-incident-release

# Additionally probe a real local scope, read-only, remediating only a temporary copy,
# and have Lens verify that copy under an explicitly supported Node 22 runtime.
node scripts/check-original-incident-release.mjs \
  --original-scope <path/to/project> --require-original-scope \
  --lens <path/to/kyro-lens> --lens-node <path/to/node22> --require-lens
```

The gate writes only under the OS temp directory and refuses any other target. The original project
is read, hashed and compared — never written, staged, committed, or re-scoped.
