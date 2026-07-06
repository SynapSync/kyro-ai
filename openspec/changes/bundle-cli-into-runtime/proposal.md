# Proposal: Bundle the Kyro CLI into the versioned runtime

## Intent

`npx kyro-ai install` projects the markdown runtime to `~/.agents/kyro/versions/{v}/` but leaves NO `kyro` executable on PATH (npx is ephemeral). The workflow's CLI-owned `close-sprint` step is non-hand-editable by contract, so agents finish a sprint and BLOCK at close because `command -v kyro` returns nothing. Real incident: an opencode agent stalled at close with all 8 tasks done. The blocker is the CLI binary, not the MCP server (opencode uses `mcpStrategy: 'none'`). Since `package.json` has `dependencies: []` and builds with plain `tsc`, `dist/` runs standalone — we can ship it inside the runtime.

## Scope

### In Scope
- Project `dist/` into the versioned runtime and register it in `manifest.managedFiles`.
- Resolve a `kyroInvocation` at install: `kyro` if on PATH, else `node ~/.agents/kyro/current/dist/cli.js` (via `current` symlink for multi-version safety).
- Introduce `{{KYRO_CLI}}` placeholder in source skills/commands/agents; substitute at projection time across all projected targets.
- Fix `codex.ts:55` MCP registration (bare `command="kyro"`) to the resolved form.
- Add a `doctor` self-check running `<kyroInvocation> --version`.
- Audit PACKAGE_ROOT-relative asset parity for every workflow command.

### Out of Scope
- Global `npm i -g kyro-ai` (rejected — see Approach).
- Relaxing the close-sprint contract to allow hand-editing `sprint.json` (would skip the analyze pre-close gate; contract is correct).
- Backward-compat auto-repair beyond documenting the one-time re-run of `kyro install`/`sync` after upgrade.

## Capabilities

### New Capabilities
- `runtime-cli-bundling`: self-contained projected runtime + resolved CLI indirection so workflow CLI steps run without a PATH binary.

### Modified Capabilities
- None (no existing openspec specs).

## Approach

Project the dependency-free `dist/` into `{runtimeRoot}` mirroring npm package layout, and route every CLI reference through `{{KYRO_CLI}}` substitution resolving to `kyro` or `node {current}/dist/cli.js`. Rejected: `npm i -g` — invasive global mutation, sudo/EACCES risk, package-manager guessing, and a single global version conflicts with the intentional multi-version `versions/{v}/` layout (reintroduces drift).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| install-plan / `buildInstallPlan` | Modified | Copy `dist/` into runtime; add managedFiles |
| `src/cli/constants.ts:18` | Constraint | `PACKAGE_ROOT` becomes `{runtimeRoot}`; assets must mirror layout |
| `src/cli/routing.ts:36` | Verify | Reads `PACKAGE_ROOT/skills/.../modes/*` (matches today) |
| `skills/**`, `commands/**`, `agents/**` | Modified | Literal `kyro` → `{{KYRO_CLI}}` |
| `src/cli/adapters/codex.ts:55` | Modified | Resolved MCP command form |
| `scripts/check-adapter-fixtures.mjs`, `scripts/check-mcp.mjs` | Modified | Update for substitution |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| PACKAGE_ROOT asset mismatch | Med | Mirror layout; smoke-run each workflow cmd on a fixture |
| Placeholder leaks into published npm package | Med | Substitute only at projection; check no projected file keeps raw `{{KYRO_CLI}}` |
| Multi-version drift | Low | Invocation uses `current` symlink, not pinned path |
| Uninstall leaves projected `dist/` | Low | Covered by `managedFiles` |

## Rollback Plan

Revert install-plan changes and placeholder substitution; source keeps literal `kyro`. No persisted user data migrated, so reverting the release restores prior projection behavior. Immediate stuck-agent unblock (independent): `npx kyro-ai@<v> close-sprint --kyro-scope <scope> --outcome shipped`.

## Dependencies

- Verification gate `npm run check` (incl. `check:eval` → needs `npm run build` first). No unit runner; fast feedback via `npm run typecheck`.

## Success Criteria

- [ ] Install into a temp HOME with `kyro` stripped from PATH; projected invocation runs `close-sprint` on a fixture scope, writes archive `.json`+`.md`, sets `activeSprint=null`, appends ledger.
- [ ] No projected file contains raw `{{KYRO_CLI}}`.
- [ ] `doctor` fails with remedy when the invocation does not resolve.
- [ ] `npm run check` green; adapter/mcp fixtures updated; 4 metadata files version-synced.
