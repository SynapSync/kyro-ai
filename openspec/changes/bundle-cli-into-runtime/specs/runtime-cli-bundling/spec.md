# Spec Delta: `runtime-cli-bundling`

Status: draft
Change: `bundle-cli-into-runtime`

## Context

`npx kyro-ai install` projects the markdown workflow runtime to
`~/.agents/kyro/versions/{v}/` (symlinked as `current`) but does not leave a
`kyro` executable on PATH, since `npx` execution is ephemeral. Workflow steps
that are CLI-owned by contract (e.g. `close-sprint`) currently reference the
literal `kyro` binary and therefore block whenever `kyro` is not resolvable
from the invoking agent's shell.

This capability is NEW (no prior openspec capture exists for it).

## Requirements

### Requirement: Projected runtime SHALL bundle a runnable CLI

The install projection SHALL copy the package's compiled `dist/` directory
into the versioned runtime root (`~/.agents/kyro/versions/{v}/dist/`) and
register every copied file under `manifest.managedFiles`, so the CLI is
runnable via `node` from the projected runtime without any global npm
installation or PATH entry.

#### Scenario: CLI runs from the projected runtime with no PATH binary

- **GIVEN** `kyro` is installed via `npx kyro-ai install` into a temp `HOME`
- **AND** `kyro` is NOT present on `PATH`
- **WHEN** `node ~/.agents/kyro/current/dist/cli.js --version` is executed
- **THEN** the process exits with code `0`
- **AND** it prints the installed CLI version

#### Scenario: Projected `dist/` is tracked and removed on uninstall

- **GIVEN** `kyro` has been installed and `dist/` was projected into
  `~/.agents/kyro/versions/{v}/dist/`
- **WHEN** `manifest.json` is inspected after install
- **THEN** every projected file under `dist/` appears in `managedFiles`
- **WHEN** `kyro uninstall` (or the equivalent uninstall path) is run
- **THEN** the projected `dist/` directory no longer exists on disk

---

### Requirement: All projected CLI references SHALL resolve to a runnable invocation

At install time, the system SHALL resolve a single `kyroInvocation` string:
`kyro` if a `kyro` binary is found on `PATH`, otherwise
`node {resolved-current-symlink-path}/dist/cli.js`. Every occurrence of the
`{{KYRO_CLI}}` placeholder in source skills, commands, and agent files SHALL
be substituted with this resolved invocation at projection time. Source
files SHALL retain the literal `{{KYRO_CLI}}` placeholder; substitution SHALL
happen only in the projected copies.

#### Scenario: Resolution prefers PATH `kyro` when available

- **GIVEN** a `kyro` binary is present and resolvable on `PATH`
- **WHEN** install/sync projects skills, commands, and agents
- **THEN** every projected occurrence of `{{KYRO_CLI}}` is replaced with the
  literal command `kyro`

#### Scenario: Resolution falls back to `node {current}/dist/cli.js`

- **GIVEN** no `kyro` binary is resolvable on `PATH`
- **WHEN** install/sync projects skills, commands, and agents
- **THEN** every projected occurrence of `{{KYRO_CLI}}` is replaced with
  `node ~/.agents/kyro/current/dist/cli.js` (resolved via the `current`
  symlink, not a version-pinned path)

#### Scenario: No projected file leaks the raw placeholder

- **GIVEN** a completed install into a temp `HOME`
- **WHEN** every file under `~/.agents/kyro/versions/{v}/{skills,commands,agents}/**`
  is scanned for the literal string `{{KYRO_CLI}}`
- **THEN** zero matches are found

#### Scenario: Source files keep the literal placeholder

- **GIVEN** the package source tree (`skills/**`, `commands/**`, `agents/**`
  as shipped in the npm package / repo, prior to projection)
- **WHEN** those files are scanned for `{{KYRO_CLI}}`
- **THEN** the placeholder IS present verbatim (substitution is a
  projection-time concern only, never a build-time or publish-time rewrite)

---

### Requirement: PACKAGE_ROOT-relative assets SHALL resolve correctly when CLI is bundled

Once `dist/` and its adjacent assets are projected into
`{runtimeRoot}`, `PACKAGE_ROOT` as computed by the projected CLI (relative to
its own `dist/cli.js` location) SHALL equal `{runtimeRoot}`, so every
workflow command that reads `PACKAGE_ROOT`-relative assets (including, at
minimum, routing-mode lookups used by `context-pack`) continues to resolve
those assets identically to running from the npm package layout.

#### Scenario: Routing-mode asset lookup succeeds from the projected CLI

- **GIVEN** the projected runtime at `~/.agents/kyro/versions/{v}/`
  contains `dist/`, `skills/`, `commands/`, and `agents/` mirroring the npm
  package layout
- **WHEN** a workflow command that resolves assets under
  `PACKAGE_ROOT/skills/.../modes/*` (e.g. `context-pack` routing) is invoked
  via the projected `node {runtimeRoot}/dist/cli.js`
- **THEN** the command locates and reads the expected mode asset without a
  missing-file error

#### Scenario: Every workflow CLI command is asset-parity audited

- **GIVEN** the set of workflow CLI commands that read files relative to
  `PACKAGE_ROOT`
- **WHEN** each such command is smoke-run from the projected runtime layout
- **THEN** each command resolves its assets successfully (no command
  silently falls back to a stale or missing path)

---

### Requirement: `close-sprint` SHALL complete end-to-end via the projected CLI without a PATH binary

#### Scenario: Full close-sprint run against a completed sprint

- **GIVEN** a temp `HOME` with `kyro` installed and stripped from `PATH`
- **AND** a scope with a completed `activeSprint` (all tasks done)
- **WHEN** the resolved invocation runs
  `close-sprint --kyro-scope <scope> --outcome shipped`
- **THEN** an archive `.json` file is written
- **AND** an archive `.md` file is written
- **AND** `ledger[]` in the scope's state has a new entry appended
- **AND** `activeSprint` is set to `null`
- **AND** the command exits `0` without requiring a `kyro` binary on `PATH`

---

### Requirement: `doctor` SHALL detect a non-runnable CLI invocation and report an actionable remedy

#### Scenario: Doctor passes when the resolved invocation executes

- **GIVEN** a valid, resolvable `kyroInvocation` (either PATH `kyro` or the
  projected `node {current}/dist/cli.js`)
- **WHEN** `kyro doctor` runs its CLI self-check
- **THEN** the check reports PASS

#### Scenario: Doctor fails with a remedy when the invocation cannot execute

- **GIVEN** the resolved `kyroInvocation` does not execute successfully
  (e.g. the projected `dist/cli.js` is missing or the `current` symlink is
  broken)
- **WHEN** `kyro doctor` runs its CLI self-check
- **THEN** the check reports FAIL
- **AND** the failure output includes an actionable remedy (e.g. re-run
  `kyro install` or `kyro sync`)

---

### Requirement: The codex MCP adapter SHALL register a runnable command, not a bare `kyro` reference

#### Scenario: Codex MCP registration uses the resolved invocation

- **GIVEN** `kyro` is NOT on `PATH`
- **WHEN** the codex adapter generates its MCP server registration
- **THEN** the registered `command` is the resolved invocation
  (`node {current}/dist/cli.js`), not the bare literal `command="kyro"`

#### Scenario: Codex MCP registration still works when `kyro` is on PATH

- **GIVEN** `kyro` IS on `PATH`
- **WHEN** the codex adapter generates its MCP server registration
- **THEN** the registered `command` is `kyro`

## Verification

- `npm run check` (includes `npm run build` prerequisite for `check:eval`)
- `npm run typecheck` for fast feedback
- Integration check: install into a temp `HOME` with `PATH` stripped of
  `kyro`, run `--version`, `close-sprint`, and `doctor` against a fixture
  scope
- `scripts/check-adapter-fixtures.mjs` and `scripts/check-mcp.mjs` updated
  and passing for the substituted command form
- Manual scan of projected output tree for the raw `{{KYRO_CLI}}` string
  (must be zero matches)
