# Design: Bundle the Kyro CLI into the versioned runtime

## 1. Context & Constraints

`npx kyro-ai install` projects the markdown runtime to `~/.agents/kyro/versions/{v}/`
(symlinked as `current`) but leaves **no `kyro` binary on PATH**. Workflow CLI-owned
steps (`close-sprint`, `analyze`, …) then fail at `command -v kyro`.

Two hard constraints shape every decision:

- **C1 — PACKAGE_ROOT resolution.** `constants.ts:18` sets
  `PACKAGE_ROOT = resolve(__dirname, '../..')`. Compiled `constants.js` lives at
  `{root}/dist/cli/constants.js`, so `../..` climbs `dist/cli → dist → {root}`.
  When we invoke `node {runtimeRoot}/dist/cli.js`, `__dirname` becomes
  `{runtimeRoot}/dist/cli` and therefore **`PACKAGE_ROOT === {runtimeRoot}`**.
  Every PACKAGE_ROOT-relative asset a workflow command reads **must exist under
  `{runtimeRoot}` in the same relative layout as the npm package**.
- **C2 — Zero runtime dependencies.** `package.json` has `dependencies: []` and builds
  with plain `tsc`. `dist/` is standalone → shippable inside the runtime, offline and
  version-locked.

The chosen approach (project `dist/` into the runtime + route every CLI reference
through a resolved `{{KYRO_CLI}}` indirection) is fixed by the proposal. This design
specifies the **HOW**: layout mirroring, the invocation value object, the substitution
mechanism, adapter/doctor wiring, and the integration test.

## 2. Architecture Approach

Ports-and-adapters framing applied to the install pipeline (the code is already
plan-as-data → executor). We keep the **plan a pure value**, push all environment
probing behind a thin resolver, and make substitution a property of the copy step —
not scattered string edits.

```
buildInstallPlan (application / composition)
  ├─ resolveKyroInvocation()        [domain value ← infra PATH probe]   NEW
  ├─ projectRuntime()               dist/ + package.json + config.json parity
  ├─ projectSkills/commands/agents  copy-with-substitutions ({{KYRO_CLI}})
  └─ adapters.buildMcpProjection    codex MCP uses resolved invocation
        │
        ▼
OperationPlan[]  (pure data — no I/O, fully snapshot-testable)
        │
        ▼
applyOperationPlan (infrastructure executor)
  └─ copy step: verbatim OR text substitution when `substitutions` present   NEW
```

**Dependency rule:** `resolveKyroInvocation` is a pure function of
`(kyroOnPath: boolean, kyroRoot: string)`; the PATH probe (`command -v kyro`) is the
only side effect and is isolated so the resolver is unit/integration-testable without a
real PATH. The plan stays free of I/O; the executor stays free of policy.

## 3. Runtime Layout — dist/ projection & PACKAGE_ROOT parity

### 3.1 What gets projected

`buildInstallPlan` (`src/cli/install-plan.ts`) adds, alongside today's copies:

```
addCopyDirectoryPlan(plan, 'dist',        `${runtimeRoot}/dist`);          // the CLI itself
addCopyFilePlan(plan, 'package.json',     `${runtimeRoot}/package.json`);  // parity: --version, mcp serverInfo
addCopyFilePlan(plan, 'config.json',      `${runtimeRoot}/config.json`);   // parity: budget manifest
```

`core/config.json` and `core/WORKFLOW.yaml` copies **stay** (referenced by `KYRO.md`
bootstrap and unaffected readers). The root copies are additive parity mirrors — do not
remove the `core/` copies.

### 3.2 PACKAGE_ROOT asset audit (Read-tool verified)

Classification of every `PACKAGE_ROOT` reader, and whether it runs **FROM the runtime**
(a workflow command an agent invokes via `{{KYRO_CLI}}`) or **FROM the package** (an
install/dev/meta command run out of the npm package where PACKAGE_ROOT is already the
package root):

| Reader (file:line) | Asset read (PACKAGE_ROOT-relative) | Runs from runtime? | Parity status |
|---|---|---|---|
| `routing.ts:36` `routeModePath` | `skills/sprint-forge/assets/modes/{mode}` | Yes (`context-pack` → `resolveRoute`) | OK — `skills/` already projected 1:1 |
| `budget-manifest.ts:11` `loadBudgetManifest` | `config.json` | Yes (`context-pack` → `resolveRoute` → `resolveBudgetRouting`) | **FIX** — was only `core/config.json`; add root `config.json` |
| `help.ts:4` `readPackageVersion` | `package.json` | Yes (`--version`, used by the new doctor self-check; `mcp/server.ts:39` serverInfo) | **FIX** — add root `package.json` |
| `constants.ts:18` | (defines PACKAGE_ROOT) | n/a | n/a — resolves to `{runtimeRoot}` by design |
| `fs.ts:38/56/70` | copy sources, `readJsonFromPackage/Text` | From package (install/sync/doctor) | No change needed |
| `doctor.ts:83/101/109/253` | `.claude-plugin/plugin.json`, `agents/*`, `WORKFLOW.yaml` | From package (`kyro doctor` dev/meta) | No change needed |
| `token-audit.ts:221/317/392/408` | `agents/`, arbitrary files | From package (dev meta) | No change needed |
| `eval/runner.ts:74`, `eval/discovery.ts:14` | `dist/cli.js`, `fixtures/evals` | From package (dev eval) | No change needed |

### 3.3 Per-workflow-command verdict

| Workflow command | PACKAGE_ROOT dependency | Mirrored asset required |
|---|---|---|
| `close-sprint` | none (self-contained: artifact I/O under WORKSPACE_ROOT only) | none |
| `context-pack` | `skills/.../modes` **and** `config.json` (budget) | `skills/` ✓, `config.json` (root) FIX |
| `analyze` | none (imports `core/analysis`, artifact paths) | none |
| `review` | none | none |
| `repair` | none | none |
| `scope` | none | none |
| `trace` | none | none |
| `--version` (doctor self-check target) | `package.json` | `package.json` (root) FIX |

**Net new mirrored assets: `dist/`, root `package.json`, root `config.json`.**
`skills/` parity already holds.

### 3.4 managedFiles registration

`buildManagedFiles` appends:

```
files.push(...listRelativeFiles('dist').map((f) => `${runtimeRoot}/dist/${f}`));
files.push(`${runtimeRoot}/package.json`, `${runtimeRoot}/config.json`);
```

This guarantees clean uninstall (§8) and keeps `checkGlobalRuntime` (doctor) honest —
it verifies every `${KYRO_GLOBAL_ROOT}/…` managed file exists.

## 4. Invocation resolution (`kyroInvocation` value object)

New module `src/cli/invocation.ts`:

```ts
export const KYRO_CLI_PLACEHOLDER = '{{KYRO_CLI}}';

export interface KyroInvocation {
  raw: string;          // e.g. "kyro"  or  "node ~/.agents/kyro/current/dist/cli.js"
  command: string;      // "kyro" | "node"
  args: string[];       // [] | ["~/.agents/kyro/current/dist/cli.js"]
}

// pure: no I/O — testable
export function buildInvocation(kyroOnPath: boolean, kyroRoot: string): KyroInvocation;

// infra probe (the only side effect), isolated for injection
export function isKyroOnPath(): boolean;   // execFileSync('command -v kyro') / where, swallow errors

export function resolveKyroInvocation(): KyroInvocation; // buildInvocation(isKyroOnPath(), KYRO_ROOT)
```

- **On-PATH branch:** `raw = "kyro"`, `command = "kyro"`, `args = []`.
- **Fallback branch:** `raw = "node ${KYRO_ROOT}/dist/cli.js"`, `command = "node"`,
  `args = ["${KYRO_ROOT}/dist/cli.js"]`. `KYRO_ROOT` is the constant
  `~/.agents/kyro/current` — the **`current` symlink**, never a pinned `versions/{v}`
  path, so version bumps don't break persisted invocations (multi-version safety).
  The literal `~` is preserved; it expands in the agent's shell context where these
  commands run.

`resolveKyroInvocation()` is called **once** in `buildInstallPlan` and the resolved
`raw` string is:

- persisted in `manifest.json` → new field `KyroManifest.kyroInvocation: string`
  (schemaVersion stays 1; additive optional-safe field, readers default when absent).
- persisted in `kyro.json` → new field `KyroProjectState.kyroInvocation?: string`
  (mirrors `runtimePath`; consumed by doctor and future tooling).

`mergeProjectState` sets `kyroInvocation` from the freshly resolved value on every
install/sync so re-running upgrades the field for old installs.

**Why probe at install (not per-command):** the value is environment-stable for a given
machine+install and must be baked into projected markdown at copy time. Probing lazily
per workflow run would defeat the substitution (the markdown is static text).

## 5. Placeholder substitution

### 5.1 Token & escaping

- **Token:** `{{KYRO_CLI}}` (double-brace, mustache-style, greppable, collision-free —
  no existing content uses it).
- **Substitution is a literal global string replace** of `{{KYRO_CLI}}` →
  `invocation.raw`. The replacement contains no regex metacharacters, so use
  `String.prototype.replaceAll('{{KYRO_CLI}}', raw)` (not `RegExp`) — no escaping
  pitfalls. RTK's `.replace(` mangling is irrelevant to runtime behavior but is why
  source edits during apply must be Read-verified, not grep-verified.

### 5.2 Source edit (one-time, mechanical)

Convert literal `kyro <subcommand>` → `{{KYRO_CLI}} <subcommand>` in **source** files.
Read-tool inventory of the substitution surface (files containing a CLI-command
reference; total 33 occurrences / 14 files):

```
agents/orchestrator.md                                  (1)
skills/qa-review/SKILL.md                                (1)
skills/sprint-forge/SKILL.md                             (7)
skills/sprint-forge/assets/modes/close-sprint.md         (3)
skills/sprint-forge/assets/modes/INIT.md                 (4)
skills/sprint-forge/assets/modes/analyze.md              (3)
skills/sprint-forge/assets/modes/review-task.md          (3)
skills/sprint-forge/assets/modes/plan-sprint.md          (3)
skills/sprint-forge/assets/modes/recover.md              (2)
skills/sprint-forge/assets/helpers/learner.md            (2)
skills/sprint-forge/assets/modes/clarify.md              (1)
skills/sprint-forge/assets/modes/execute-task.md         (1)
skills/sprint-forge/assets/modes/STATUS.md               (1)
skills/sprint-forge/assets/templates/archive-sprint.md   (1)
```

`commands/{forge,status,wrap-up}.md` reference **slash commands** (`/kyro:forge`), not
the CLI binary — **do not** substitute those. Apply phase re-enumerates each occurrence
with the Read tool before editing (RTK gotcha).

### 5.3 Copy step: substitution capability

Extend `OperationPlan` with an optional field and teach the copy executor to use it:

```ts
// types.ts — OperationPlan
substitutions?: Record<string, string>;   // NEW, optional

// operation-steps.ts — copy branch
else if (operation.action === 'copy') {
  const src = resolve(context.packageRoot, operation.source);
  mkdirSync(dirname(target), { recursive: true });
  if (operation.substitutions) {
    let text = readFileSync(src, 'utf-8');
    for (const [token, value] of Object.entries(operation.substitutions)) text = text.split(token).join(value);
    writeFileSync(target, text, 'utf-8');
  } else {
    copyFileSync(src, target);   // verbatim (dist/ JS, package.json, config.json, binaries)
  }
}
```

`addCopyDirectoryPlan` / `addCopyFilePlan` gain an optional `substitutions` param,
threaded from `buildInstallPlan`. **Only** the markdown-bearing copies carry
`{ '{{KYRO_CLI}}': invocation.raw }`:

- `skills/` → `${runtimeRoot}/skills` (workflow-command references live here)
- adapter command-skill / opencode / commands-dir projections that copy source markdown

`dist/`, `package.json`, `config.json`, `WORKFLOW.yaml` copy **verbatim** (they contain
no placeholder). Generated `write` content (command-skill stubs, codex AGENTS block, MCP
block) is interpolated **in code** (§6) — it never carries the raw token.

### 5.4 Leak guard

Two layers guarantee "no projected file retains raw `{{KYRO_CLI}}`":

1. **Structural:** substitution is a property of the copy op; every markdown projection
   passes the substitution map, so a leak can only come from a missed call site.
2. **Verification:** new check `scripts/check-no-placeholder.mjs` (wired into `check:*`)
   installs into a temp HOME and asserts **no projected file** under `{runtimeRoot}` and
   the projected skills/commands dirs contains `{{KYRO_CLI}}`. It also asserts the
   **inverse** on source: source files must contain the placeholder and must NOT contain
   a bare literal CLI invocation (prevents regressions where a new mode file ships raw
   `kyro close-sprint`). The temp-HOME integration test (§9) repeats the projected-tree
   assertion as a belt-and-suspenders check.

## 6. codex adapter MCP registration

`src/cli/adapters/codex.ts:55` currently emits static `command = "kyro"`. It must emit
the resolved runnable form. Since `buildMcpProjection(plan)` has no invocation param, it
calls the shared pure resolver (deterministic, idempotent):

```ts
buildMcpProjection(plan) {
  const inv = resolveKyroInvocation();
  const command = inv.command;                       // "kyro" | "node"
  const args = [...inv.args, 'mcp', 'serve'];         // ["mcp","serve"] | ["~/.../dist/cli.js","mcp","serve"]
  plan.push({
    action: 'upsert-block',
    path: CODEX_MCP_CONFIG_PATH,
    blockName: KYRO_MCP_BLOCK,
    commentStyle: 'hash',
    content: `[mcp_servers.kyro]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}`,
  });
}
```

TOML array/string via `JSON.stringify` is valid TOML for these value shapes (double-
quoted strings, bracketed array). `scripts/check-mcp.mjs` and
`scripts/check-adapter-fixtures.mjs` fixtures update to the resolved form (fixture must
pin a deterministic invocation — inject `kyroRoot` / force the fallback branch so the
golden file is stable across machines; see §9).

## 7. doctor self-check

Add `checkCliInvocation()` to `runDoctorChecks` (`doctor.ts`):

- Read `manifest.kyroInvocation` (fallback to `resolveKyroInvocation().raw` when a
  legacy manifest lacks the field).
- Run `<invocation> --version` via `execFileSync(command, [...args, '--version'])` with
  a short timeout, stdout captured, errors swallowed into a `fail`.
- **pass** when it exits 0 and prints a version; **fail** otherwise with
  `remedy: 'Re-run kyro install (or kyro sync) so the runtime CLI is projected and the invocation is refreshed.'`
- This exercises the exact indirection the workflow relies on (`--version` reads
  `package.json` at PACKAGE_ROOT — proving the §3 parity fix end-to-end).

Placement: after `checkGlobalRuntime()` in the base check list so failures surface with
runtime diagnostics.

## 8. Uninstall

`uninstall` removes `manifest.managedFiles`. Because §3.4 registers every projected
`dist/**` file plus root `package.json`/`config.json`, removal is complete — no orphan
`dist/` left behind. `rmdir-if-empty` sweeps the emptied `dist/` and version dirs as
today. No uninstall code change beyond the managedFiles expansion; add a regression
assertion (temp-HOME install→uninstall leaves no `{runtimeRoot}/dist`).

## 9. Backward compatibility

- Existing installs (literal `kyro` in projected markdown, no bundled `dist/`) are fixed
  by **re-running `kyro install` or `kyro sync`** after upgrade: re-projection copies
  `dist/`, mirrors `package.json`/`config.json`, and substitutes `{{KYRO_CLI}}`.
- That single re-run **still needs the CLI once** (via `npx kyro-ai@<v> …` or a global
  `kyro`). This is an accepted one-time cost — documented in upgrade notes.
- **CHANGELOG wording:**
  > **Bundled runtime CLI.** The Kyro CLI now ships inside the projected runtime, so
  > workflow steps (`close-sprint`, `analyze`, …) run without a `kyro` binary on PATH.
  > **Action required once:** run `npx kyro-ai@<version> install` (or `kyro sync` if you
  > have a global install) to re-project the runtime with the bundled CLI. Existing
  > scopes and artifacts are preserved.
- Immediate, migration-independent unblock for a stuck agent:
  `npx kyro-ai@<v> close-sprint --kyro-scope <scope> --outcome shipped` from repo root.

## 10. Test strategy

No unit-test runner exists; verification is the `check:*` suite + `typecheck`.

### 10.1 New checks

| Check | What it proves | Notes |
|---|---|---|
| `scripts/check-cli-bundle.mjs` | End-to-end runtime CLI works with no PATH binary | Needs `npm run build` first (like `check:eval`) |
| `scripts/check-no-placeholder.mjs` | No projected file keeps raw `{{KYRO_CLI}}`; source keeps it | Runs on a temp-HOME projection |
| Updated `scripts/check-mcp.mjs`, `scripts/check-adapter-fixtures.mjs` | Codex MCP emits resolved form | Pin invocation for deterministic golden |

### 10.2 `check-cli-bundle` integration flow

1. `npm run build` (dist/ must be current).
2. `mkdtemp` a temp `HOME` and a temp workspace; seed a fixture scope
   `.agents/kyro/scopes/<fixture>/sprint.json` with an `activeSprint` whose tasks are all
   done and `handoff.nextAction = close_sprint` (ready-to-close shape).
3. Run install from the built package with a **PATH stripped of `kyro`** and
   `HOME=tempHOME`, cwd = temp workspace:
   `execFileSync('node', ['dist/cli.js','install','--scope','workspace'], { env: { ...clean, HOME, PATH: pathWithoutKyro } })`.
4. Read `{runtimeRoot}/manifest.json` → assert `kyroInvocation` is the **node fallback
   form** (proves PATH-less resolution) and `kyro.json.kyroInvocation` matches.
5. Assert projected-tree parity: `{runtimeRoot}/dist/cli.js`, `{runtimeRoot}/package.json`,
   `{runtimeRoot}/config.json`, `{runtimeRoot}/skills/...` all exist; assert no projected
   file contains `{{KYRO_CLI}}`.
6. Execute the **resolved invocation** verbatim against the fixture:
   `node {runtimeRoot}/dist/cli.js close-sprint --kyro-scope <fixture> --outcome shipped`
   (with the same PATH-stripped env).
7. Assert the contract: archive `<n>.json` **and** `<n>.md` written under the scope's
   `archive/`, `sprint.json.activeSprint === null`, ledger appended with a new entry.
8. (Optional smoke) run `node {runtimeRoot}/dist/cli.js --version` → asserts §3 parity
   (`package.json` reachable at PACKAGE_ROOT) — this is also what the doctor check runs.

### 10.3 Suite wiring

Add `check:cli-bundle` and `check:no-placeholder` to `package.json` scripts and to the
aggregate `npm run check`. Because both (and `check:eval`) require a fresh build, ensure
`check` runs `build` before them (or each script self-runs build). Version-sync the 4
metadata files per the CLAUDE.md checklist on release.

## 11. ADR-style decisions

### ADR-1 — Bundle `dist/` into the runtime vs `npm i -g`
**Decision:** project `dist/` into `{runtimeRoot}` and route via `{{KYRO_CLI}}`.
**Rationale:** `dependencies: []` + `tsc` → standalone, offline, version-locked; aligns
with the intentional multi-version `versions/{v}/` layout.
**Rejected — global install:** invasive global mutation, sudo/EACCES risk, package-manager
guessing, and a single global version conflicts with multi-version runtime (reintroduces
drift). **Rejected — relax close-sprint contract:** would skip the analyze pre-close gate;
the CLI-owned destructive step is correct by design.

### ADR-2 — Mirror npm layout at `{runtimeRoot}` vs rewrite PACKAGE_ROOT readers
**Decision:** add root `package.json` + `config.json` mirrors so `PACKAGE_ROOT` resolution
is transparent (`skills/` already matches).
**Rationale:** the runtime becomes a faithful package mirror; source keeps working from the
package unchanged; zero behavioral edits to readers → lowest regression risk.
**Rejected — repoint each reader to `core/…`:** touches `budget-manifest`, `help`, and any
future reader; breaks package-context execution; higher blast radius.

### ADR-3 — Substitution as a copy-op property vs post-copy pass or in-code-only
**Decision:** optional `substitutions` on the `copy` op; text read-replace-write when
present, verbatim otherwise.
**Rationale:** keeps the plan pure/snapshot-testable, colocates substitution with the copy
that needs it, leaves binaries/JSON verbatim, and gives one structural choke point for the
leak guard.
**Rejected — separate post-projection rewrite step:** adds a second traversal and a window
where raw placeholders exist on disk. **Rejected — bake invocation into source:** source
must stay generic/publishable; the placeholder is the seam.

### ADR-4 — Resolve invocation at install, persist in manifest+state
**Decision:** probe PATH once at install via a pure `buildInvocation` + isolated
`isKyroOnPath`; persist `raw` in `manifest.json` and `kyro.json`.
**Rationale:** projected markdown is static — the value must be known at copy time; the
`current` symlink keeps it version-agnostic; persisting lets doctor and future tooling read
the source of truth. **Rejected — resolve per-command at runtime:** cannot rewrite already-
projected static markdown; defeats substitution.

### ADR-5 — `{{KYRO_CLI}}` mustache token, literal `replaceAll`
**Decision:** double-brace token, global literal string replace.
**Rationale:** greppable, collision-free, no regex escaping (replacement is a shell command
string). **Rejected — `$KYRO_CLI` env indirection:** shifts burden to every agent's shell
env and breaks non-shell contexts (MCP TOML, markdown display).

## 12. Risks & assumptions

| Risk / assumption | Severity | Mitigation |
|---|---|---|
| A workflow command later adds a PACKAGE_ROOT read of an unmirrored asset | Med | §5.4 source-side guard + §10 smoke run; document the parity rule near `constants.ts` |
| `isKyroOnPath` false-positive/negative across shells (`command -v` vs `where`) | Med | Cross-platform probe (`command -v` POSIX / `where` win32), swallow errors → default to safe fallback (node form always works) |
| Placeholder leak via a new copy call site missing the map | Med | Structural choke point + `check-no-placeholder` in CI |
| TOML emission for MCP args not valid across codex versions | Low | `JSON.stringify` yields canonical TOML; covered by `check-mcp` fixture |
| Fixture golden non-determinism (machine-specific invocation) | Low | Force/inject the fallback branch in fixture generation |
| Copying full `dist/` bloats the runtime | Low | dist is small, dependency-free; acceptable and already version-scoped |

## 13. Affected files (implementation surface for tasks)

- `src/cli/invocation.ts` — **new** (value object + resolver + placeholder const)
- `src/cli/install-plan.ts` — dist/pkg/config projection, managedFiles, persist invocation, substitution wiring
- `src/cli/fs.ts` — `addCopyDirectoryPlan`/`addCopyFilePlan` optional `substitutions` param
- `src/cli/pipeline/operation-steps.ts` — copy step substitution branch
- `src/cli/types.ts` — `OperationPlan.substitutions?`, `KyroManifest.kyroInvocation`, `KyroProjectState.kyroInvocation?`
- `src/cli/adapters/codex.ts` — resolved MCP command/args
- `src/cli/commands/doctor.ts` — `checkCliInvocation`
- `skills/**`, `agents/orchestrator.md` — literal `kyro <cmd>` → `{{KYRO_CLI}} <cmd>` (14 files, §5.2)
- `scripts/check-cli-bundle.mjs`, `scripts/check-no-placeholder.mjs` — **new**
- `scripts/check-mcp.mjs`, `scripts/check-adapter-fixtures.mjs` — update fixtures
- `package.json` (+ 3 metadata files), `CHANGELOG` — scripts, version sync, upgrade note
```
