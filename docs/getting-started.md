# Getting Started with Kyro

Kyro is a portable sprint workflow kit for AI coding agents (**kyro-ai**, `sprint.json` schema v4). It installs a global runtime and tiny command skills; each project keeps state under `.agents/kyro/`.

> New here? The [README](../README.md) is the client-facing tour. This page is the slightly deeper first-run guide.

## Prerequisites

- Node.js ≥ 18
- Git
- An AI coding agent that can read `~/.agents/skills`, root `AGENTS.md`, slash commands, or markdown instructions

## Install

**Run every install/sync from the project root** (the repository Kyro should manage). The global runtime and skills always land under your home directory; **project state** (layered files under `.agents/kyro/` and registration of `scopes/`) is written relative to the **current working directory**. If you install from `~` or another folder, you still get the runtime—but Kyro state appears in the wrong place.

Always install and sync with **`npx kyro-ai@latest …`** so you get the current release (omit `@latest` only if you intentionally pin a version).

Default standard install:

```bash
cd /path/to/your-app
npx kyro-ai@latest install --scope workspace --init-workspace --yes
```

`--init-workspace` creates or refreshes **layered** project state in this directory (non-interactive):

- `.agents/kyro/project.json` — shared (safe to commit): principles, team policy, scopes registry cache
- `.agents/kyro/local.json` — personal/machine (gitignored): `activeScope`, installed adapters
- `.agents/kyro/.gitignore` — ignores local-only files; never ignores `project.json` or `scopes/`

It also **rehydrates** any existing `scopes/` folders (common after cloning a team repo that commits scopes + `project.json` while each developer keeps a personal `local.json`).

Agent-specific installs (still from the project root):

```bash
npx kyro-ai@latest install --agent opencode --scope workspace --init-workspace --yes
npx kyro-ai@latest install --agent codex --scope workspace --init-workspace --yes
```

Claude Code can use the first-class plugin (see [README](../README.md#choose-your-host)); the CLI install still projects the shared runtime and project state when you want them—run it from the project root.

## What gets installed

Global runtime:

```text
~/.agents/kyro/current/
├── commands/
├── core/
├── skills/
├── dist/                 # projected CLI (dist/cli.js)
├── package.json
├── config.json
└── manifest.json         # includes kyroInvocation
```

Kyro keeps only this active runtime. Reinstalling or upgrading replaces `current/`; old versioned runtime folders are cleaned instead of retained.

Global command skills:

```text
~/.agents/skills/
├── kyro-forge/SKILL.md
├── kyro-status/SKILL.md
├── kyro-task-context/SKILL.md
├── kyro-idea/SKILL.md
└── kyro-qa/SKILL.md
```

OpenCode installs equivalent native entrypoints under `~/.config/opencode/` when you use `--agent opencode`.

Project state (layered):

```text
.agents/kyro/
├── project.json          # shared — commit
├── local.json            # personal — gitignored
├── .gitignore            # install/sync assist
└── scopes/
```

`kyro install` does not create a scoped `sprint.json`; forge/INIT creates it when a scope is opened for the first time. If `scopes/` already has directories (for example after cloning a team repo), install/sync **registers** them into the shared `project.json` scopes registry. With multiple scopes, set yours with:

```bash
node ~/.agents/kyro/current/dist/cli.js scope set-active <scope> --yes
# or: kyro scope set-active <scope> --yes   # when a durable global bin exists
```

Full multi-dev commit matrix: [Teams](teams.md).

### CLI invocation (important)

`npx kyro-ai@latest install` does **not** permanently put `kyro` on PATH. Install/sync records a durable invocation in the **global** `manifest.json` only (bare `kyro` only if a real global bin exists; otherwise `node ~/.agents/kyro/current/dist/cli.js`). Projected modes under `current/` substitute that string for agents. Project state files are not the source of truth for the CLI string — one install/sync refreshes invocation for every workspace on the machine.

Installed as a **Claude Code plugin** instead (marketplace install, no `npx kyro-ai install` ever run)? The plugin channel ships the raw skill/agent files unsubstituted — the orchestrator resolves the CLI invocation itself at the start of every session (same `kyro` vs. `node ~/.agents/kyro/current/dist/cli.js` decision, see `agents/orchestrator.md`'s Startup Step 1), so no separate setup is required for that path either.

After upgrades (from the project root):

```bash
cd /path/to/your-app
npx kyro-ai@latest sync --scope workspace --yes
```

See [CLI · invocation persistence](cli.md#cli-invocation-persistence-kyroinvocation).

## First run

Use the installed command skill or slash command:

```text
kyro-forge auth-refactor
```

or, in Claude-style slash command environments:

```text
/kyro:forge auth-refactor
```

Kyro routes progressively:

1. read layered project state (`.agents/kyro/project.json` + `local.json`, or legacy `kyro.json` dual-read)
2. resolve or create scope
3. read the scope's lean pack / `sprint.json` if present
4. route on `sprint.json.handoff.nextAction` and load only the required mode: INIT, clarify, plan, execute, review, close, done, or recover
5. record task evidence and status through **tool-owned CLI verbs** during execution (`record-evidence`, then `review` for the checker verdict — **no hand-editing** of `sprint.json`), then close via `close-sprint`

## Delegated execution (optional)

By default, `/kyro:forge` runs as a **single agent**: the orchestrator implements, records evidence, and reviews. You can opt in to **delegated execution** so a host subagent implements or reviews **one task** while the orchestrator keeps ownership of `sprint.json` through the Kyro CLI.

There is **no** separate slash command or CLI verb such as `kyro delegate`. Activation is configuration plus natural language inside forge.

### Activation

| Layer | How to enable | Effect |
| ----- | ------------- | ------ |
| **L1 (automatic)** | Set `execution.delegationEnabled: true` in `.agents/kyro/local.json` | `context-pack` surfaces `delegationEnabled: true`; execute/review modes load delegate role helpers |
| **L0 (per task)** | Ask in chat during forge (even when L1 is off) | Orchestrator follows the delegation protocol for that task only |

L1 example (personal, gitignored):

```json
{
  "schemaVersion": 4,
  "activeScope": "my-scope",
  "execution": {
    "delegationEnabled": true
  }
}
```

Verify:

```bash
node ~/.agents/kyro/current/dist/cli.js context-pack \
  --kyro-scope my-scope --task T1.1 --json | jq .delegationEnabled
# → true
```

Full field contract: [Teams — Delegation opt-in](teams.md#delegation-opt-in-l1). Protocol detail: [Architecture — Delegated execution](architecture.md#delegated-execution-protocol-opt-in). **Practical walkthrough with flow diagrams:** [Delegation flow](delegation-flow.md).

### How to tell the agent to run task X with a delegate

Entry point is still **`/kyro:forge`** (or `kyro-forge`). Name the scope and task id.

**With L1 enabled** — delegation is automatic during `execute_task`:

```text
/kyro:forge

Continue scope my-scope. Execute task T1.1.
```

**Without L1** — ask explicitly:

```text
/kyro:forge

Scope: my-scope
Execute task T1.1 with a delegate implementer.
Load delegates/implementer.md. You orchestrate record-evidence and review via CLI.
```

**Checker delegate during review:**

```text
/kyro:forge

Review task T1.1 with a fresh checker delegate (delegates/checker.md).
You apply findings through kyro review — the delegate does not touch sprint.json.
```

### What each role does

| Role | Does | Does not |
| ---- | ---- | -------- |
| **Orchestrator** | `context-pack`, brief, spawn delegate, `record-evidence`, `review`, handoff | Delegate all sprint ownership |
| **Implementer delegate** | Product code, scoped validation, status JSON | `record-evidence`, `review`, edit `sprint.json` |
| **Checker delegate** | Independent review, findings JSON | Self-approve; mutate project state |

One task = one implementer delegate. "Run the phase with delegates" means the orchestrator **loops** tasks — no delegate owns a whole phase.

### Typical CLI checks before delegating

```bash
node ~/.agents/kyro/current/dist/cli.js status --kyro-scope my-scope
node ~/.agents/kyro/current/dist/cli.js context-pack \
  --kyro-scope my-scope --task T1.1 --json
```

The task pack (`taskDescription`, `taskFiles`, acceptance criteria, `delegationEnabled`) is the brief source — not the full `sprint.json`.

### Copy-paste orchestrator prompt

```text
/kyro:forge

Scope: my-scope
Runtime: node ~/.agents/kyro/current/dist/cli.js

Execute T1.1 with delegate implementer.
1. context-pack --task T1.1
2. Spawn delegate per delegates/implementer.md (one task, one delegate)
3. Delegate returns status JSON only
4. You: record-evidence T1.1 (no --yes), then review T1.1 --verdict pass|fail --yes
```

CLI reminder: `record-evidence` never takes `--yes`; `review` does. Mixing them is a common orchestrator slip.

If the host cannot spawn subagents, the orchestrator falls back to single-agent execution — forge does not fail.

## Scope output

After INIT, a scope looks like:

```text
.agents/kyro/scopes/{scope}/
├── sprint.json          # single source of truth
├── archive/             # write-only, at sprint close
└── findings/            # write-only INIT analysis evidence
```

`sprint.json` holds the objective, success criteria, roadmap, active sprint, debt, conventions, ADRs, and handoff routing. When the scope is created via `kyro plan` and at least one of git `user.name` or a valid `user.email` is set, it also stores an optional immutable `author` (scope creator; present fields only; never blocks init). `archive/` receives a verbatim snapshot plus a human narrative each time a sprint closes.

## Verify

```bash
node ~/.agents/kyro/current/dist/cli.js doctor
node ~/.agents/kyro/current/dist/cli.js doctor --artifacts
```

Use the **full npm package** (`npx kyro-ai@latest` or a global `kyro` from `npm i -g kyro-ai`) for `install`, `sync`, and `doctor --tokens`. Day-to-day workflow uses installed skills and the projected runtime CLI (including `doctor --artifacts`).

`doctor --tokens` audits realistic Kyro runtime paths and fails forbidden eager helper loading or over-budget paths — run it from the full package.

## Next steps

- [CLI](cli.md)
- [Teams & multi-dev](teams.md) — includes `delegationEnabled` in `local.json`
- [Delegated execution](getting-started.md#delegated-execution-optional) — activate and prompt the orchestrator
- [Agent adapters](agent-adapters.md)
- [Commands reference](commands-reference.md)
- [Architecture](architecture.md)
