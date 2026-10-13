# Teams & multi-developer project state

Kyro is designed so several developers (and agents) can share sprint artifacts without thrashing personal fields in git.

This page is the **multi-dev contract**. Behavior is enforced by install/sync, `readProjectState`, doctor, and the layered writers — docs here describe what to commit and how to bootstrap a clone.

## Commit matrix

| Path | Commit? | Owner | Contents |
| ---- | ------- | ----- | -------- |
| `.agents/kyro/project.json` | **Yes** | Team / shared | `schemaVersion`, `artifactRoot`, `principles[]`, global `conventions[]`, optional `team` policy |
| `.agents/kyro/local.json` | **No** | Personal / machine | `activeScope`, optional `runtimePath`, optional `execution.delegationEnabled` (L1 delegation opt-in) |
| `.agents/kyro/scopes/**` | **Yes** | Team | Per-scope `sprint.json`, archives, findings |
| `.agents/kyro/.gitignore` | **Yes** (recommended) | Team | Written/updated by install/sync so local-only files stay untracked |
| Legacy monolito (see [Migration](#migration--dual-read)) | **No** | Migration only | Superseded by the two files above |

Harness choice is per machine, shared by all workspaces on that machine. One install projects canonical skills and every detected, enabled harness; teammates can use different harnesses without changing shared project state. `kyro adapters list|enable|disable` manages machine choices, and disable survives another project's sync/update. Config integrations require opt-in on fresh installs. Workspace uninstall preserves machine projections and home integrations; machine removal requires `kyro uninstall --machine`. See [Agent adapters](agent-adapters.md).

**Never store CLI invocation on project files.** `kyroInvocation` lives only in `~/.agents/kyro/current/manifest.json` (global runtime).

### Shared vs local fields

| Field | Layer | Notes |
| ----- | ----- | ----- |
| `principles` | shared only | Team constitution; travels with git |
| `conventions[]` | shared only | Optional global operational rules inherited by every scope; add through `kyro rule add --global` |
| `team` (e.g. `minPackageVersion`) | shared only | Optional fleet floor — doctor **WARN**s if runtime is older (non-blocking) |
| `scopes[]` | derived from disk | Valid matching `scopes/<id>/sprint.json` files determine the effective scope list; not stored in `project.json` |
| `activeScope` | local only | Personal — never on `project.json` |
| `installedAdapters` | legacy local read only | Migrated into the machine registry; no longer written by install/sync |
| Adapter choices | machine only | `~/.agents/kyro/adapters.json`; never committed or selected by project state |
| `execution.delegationEnabled` | local only | L1 delegation opt-in; default off; surfaced on `context-pack` JSON |

### Delegation opt-in (L1)

Add to `.agents/kyro/local.json` (gitignored):

```json
{
  "execution": {
    "delegationEnabled": true
  }
}
```

| Rule | Detail |
|------|--------|
| Default | Absent or `false` → single-agent forge |
| Storage | **local.json only** — not `project.json` |
| Verify | `kyro context-pack --json \| jq .delegationEnabled` → `true` |

Never auto-enable on install/sync. See [Architecture — Delegated execution](architecture.md#delegated-execution-protocol-opt-in).

**How to use it in forge** (prompts, L0 vs L1, role split): [Getting started — Delegated execution](getting-started.md#delegated-execution-optional).

## Clone bootstrap

```bash
npm install -g kyro-ai
cd /path/to/clone
kyro install --scope workspace --init-workspace --yes
# if multiple scopes:
kyro scope set-active <scope> --yes
```

What install does:

1. Writes or refreshes **`project.json` + `local.json`** (not a live monolito SoT).
2. Ensures **`.agents/kyro/.gitignore`** ignores `local.json`, legacy `kyro.json` / `kyro.json.migrated`, and lock files — and **never** ignores `project.json` or `scopes/`.
3. Reads scopes from valid matching `sprint.json` files under safe managed directories. Foreign,
   corrupt, and incomplete directories do not become scopes. Removes legacy `project.json.scopes[]`
   only when every old ID has a valid matching sprint file and no legacy metadata would be lost;
   otherwise installation stops without changing the shared state and names the unresolved entries.
4. Sets `activeScope` automatically only when it is null and **exactly one** scope is known.

You do **not** need to gitignore the entire `.agents/kyro/` directory.

## Read-only commands (no side effects)

`status`, `doctor`, and `context-pack` **never create** project state files. If layers are missing, they surface an actionable bootstrap remedy:

```text
Install the CLI with npm install -g kyro-ai; then, from the project root, run kyro install --init-workspace --yes. Existing scopes are read from their sprint.json files.
```

## Migration & dual-read

> This section is the **only** place Kyro documents the pre-layered monolito by name. Everywhere
> else — commands, skills, agent contracts, the rest of the docs — the project state is
> `project.json` + `local.json`, full stop. If you are starting fresh, you can skip this section
> entirely; it exists so workspaces created before layered state have a defined way out.

Kyro's project state used to be a single `.agents/kyro/kyro.json`. It is superseded and **never
written** — the only remaining behavior is getting you off it:

- Workspaces that still have only the legacy monolito are **read** through dual-read, so nothing
  breaks before you migrate.
- Install/sync **migrates** it to layers and archives the original as `kyro.json.migrated`. That
  archived file is inert; delete it whenever you like.
- If both layers and a live monolito remain, **doctor WARNs** (it does not hard-fail fleets
  mid-migration).

To migrate now, from the project root:

```bash
npm install -g kyro-ai
cd /path/to/your-project
kyro install --scope workspace --init-workspace --yes
```

Then confirm `project.json` + `local.json` hold what you expect and remove `kyro.json.migrated`.

### Legacy adapter migration

Older `local.json` files may contain `installedAdapters`. Install/sync continues reading those records and unions newly encountered adapters into `~/.agents/kyro/adapters.json`, enabling integrations for legacy entries to preserve existing configuration. Existing machine choices take precedence, including opt-out. The runtime manifest derives adapters from that machine registry; syncing a different workspace no longer replaces the selection. Install/sync no longer writes `installedAdapters` to `local.json`. Migrate each legacy clone through install/sync; the registry does not scan other workspaces automatically.

## Optional team package floor

In `project.json`:

```json
{
  "schemaVersion": 4,
  "artifactRoot": ".agents/kyro/scopes",
  "team": { "minPackageVersion": "4.34.0" }
}
```

Doctor emits a non-blocking **WARN** when the installed runtime package is older than `team.minPackageVersion`.

## Non-goals (this contract)

- Cloud/live multi-machine state sync
- CRDT / multi-writer merge of `sprint.json` handoff
- Task claim/ownership CLI as required MVP
- Shipping the global runtime inside the consumer repo
- Auto-editing the repository root `.gitignore` (only `.agents/kyro/.gitignore`)

## Related

- [Getting started](getting-started.md) — first install
- [CLI](cli.md) — flags, rehydrate rules, doctor
- [README · teams](../README.md#upgrade-teams-multi-dev) — short table
