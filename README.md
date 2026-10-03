# Kyro AI

[![npm](https://img.shields.io/npm/v/kyro-ai)](https://www.npmjs.com/package/kyro-ai) [![CI](https://github.com/SynapSync/kyro-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/SynapSync/kyro-ai/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENSE)

Kyro gives AI coding agents a durable, CLI-governed way to plan, execute, and review software work. Plans and evidence live in the project instead of disappearing with a chat session. Choose the workflow explicitly: **Forge** for scope-and-sprint delivery, or **Work** for a task-based plan with its own lifecycle. Neither path is selected by the size or difficulty of the job.

Kyro works through a CLI and host adapters for Claude Code, Codex, OpenCode, and other skill-capable agents. The agent proposes and implements; the CLI validates and writes managed state. A passing task review is an attestation by a checker, not proof that tests ran or a substitute for independent QA.

## Choose a workflow

| | Forge | Work |
| --- | --- | --- |
| Start with | A scope and sprint plan | A Markdown brief and explicit task plan |
| State | `.agents/kyro/scopes/<scope>/sprint.json` | `.agents/kyro/work/<id>/brief.md` and `work.json` |
| Flow | Scope → sprint → tasks → reviews → QA-or-close → checkpoint | Brief → tasks → evidence → reviews → close or promote |
| Use when | You want sprint checkpoints, scope-level planning, debt, and independent certification | You want a separate, task-driven path with dependencies, amendments, and explicit closure |
| Entry point | `/kyro:forge` or `kyro-forge` | `/kyro:work` or `kyro-work`, selected explicitly |

Work is **not** restricted to small or quick jobs. A Work can later be promoted into a **new** Forge scope through an explicit, recoverable CLI transaction. Promotion transfers selected unfinished tasks, not approvals: Forge tasks start pending and follow Forge's own review and QA process. It does not change the active Forge scope. See the [Work guide](docs/work.md).

Before either path, `/kyro:idea` can mature an idea into a plan. Idea does not automatically choose or create a Forge scope or Work.

## Install and verify

Requires Node.js 18 or newer and Git. From the root of the project where you will use Kyro:

```bash
npm install -g kyro-ai
kyro install --init-workspace --yes
kyro --version
kyro doctor --artifacts
```

Installation projects the runtime and command skills under `~/.agents/`, and initializes project-local `.agents/kyro/` state. Check `kyro capabilities --json` before relying on a command such as `work`: a locally installed older runtime does not gain new verbs merely because this repository was built. `kyro update` refreshes an installed runtime from a published package; it is not part of developing or testing a release candidate.

For Claude Code, install its native skills through the same CLI-managed runtime:

```bash
kyro install --agent claude --scope workspace --init-workspace --yes
kyro doctor --adapters
```

Claude discovers `/kyro-forge`, `/kyro-work`, and the other `kyro-*` skills under `~/.claude/skills/`. The former plugin commands (`/kyro-ai:*`) are not installed by this adapter. If you previously installed the Kyro plugin, verify the new skills and then disable or uninstall that plugin in Claude Code to avoid duplicate or stale entrypoints; Kyro never changes your plugin settings automatically. Use `kyro update` for future published updates. Codex uses projected `kyro-*` skills; OpenCode has native `/kyro/*` commands and skills. See [agent adapters](docs/agent-adapters.md) for the full migration. If a team shares project state, each member initializes from their own clone; `local.json` remains personal.

## First steps

For a Forge scope, ask your agent to run `/kyro:forge` (or its installed `kyro-forge` skill) with the outcome you want. Forge asks for approval at planning gates, writes sprint state through the CLI, and routes the next task from a fresh context pack. The typical progression is:

```text
scope initialization → sprint plan → task execution → evidence → review
                     → independent QA or close decision → sprint checkpoint
```

For Work, write a Markdown brief that states a verifiable outcome, then create the Work explicitly:

```bash
kyro work create --id search-refresh --from brief.md --dry-run --json
kyro work create --id search-refresh --from brief.md --json
kyro work status --work search-refresh --json
kyro work context-pack --work search-refresh --json
```

Create is only the beginning: use `kyro work plan` to submit the task proposal, then follow the CLI's revision-bound start, evidence, review, amendment, disposition, and closure commands. The CLI writes `work.json`; agents must not edit it directly. Preview mutating operations with `--dry-run` where supported. The [Work guide](docs/work.md) has the exact JSON inputs, flags, retry behavior, and promotion contract.

For either workflow, refresh status or context before writing. If a revision is stale, a brief changed outside the CLI, or a transaction is pending, resolve the reported blocker rather than editing managed files by hand. Work task review and Forge independent QA are deliberately different gates.

## Commands at a glance

| Agent command / skill | Purpose |
| --- | --- |
| `/kyro:forge` · `kyro-forge` | Plan, execute, review, and close a Forge sprint or complete a finished scope |
| `/kyro:work` · `kyro-work` | Enter the explicitly selected Work lifecycle |
| `/kyro:idea` · `kyro-idea` | Mature an idea before choosing a workflow |
| `/kyro:status` · `kyro-status` | Read Forge progress, roadmap, and debt |
| `/kyro:task-context` · `kyro-task-context` | Prepare a concise handoff to a fresh session |
| `/kyro:qa` · `kyro-qa` | Independently audit a Forge scope and implementation |
| `/kyro:scope-retire` · `kyro-scope-retire` | Retire an obsolete scope through a separate human-gated operation |

These entry points guide an agent; the CLI owns deterministic state changes. For flags and machine-readable output, see the [CLI reference](docs/cli.md) and [commands reference](docs/commands-reference.md).

## Project state and teams

```text
.agents/kyro/
├── project.json             # shared project policy; commit
├── local.json               # personal active scope and adapters; ignore
├── scopes/<scope>/           # shared Forge sprint state and close archives; commit
└── work/<id>/               # shared Work brief, state, and durable history; commit
```

Kyro's generated `.agents/kyro/.gitignore` excludes local state, locks, and pending transaction scratch; the Work brief and `work.json` remain trackable. A clone can read existing scopes from their sprint files. With multiple Forge scopes, select your own active scope using `kyro scope set-active <scope> --yes`. Work IDs are selected explicitly and do not silently change that Forge setting. See the [teams guide](docs/teams.md).

The global runtime lives at `~/.agents/kyro/current/`; it is not a project file. Installing a newer version never silently migrates an existing scope, and `doctor` diagnoses rather than repairs. Scope state and closed checkpoints must be changed only by supported CLI operations.

## Safety and review boundaries

- **CLI-owned writes:** `sprint.json` and `work.json` have validated schemas and transitions. Use the relevant CLI verb instead of hand-editing them.
- **Honest evidence:** recording a command and a `passed` result is a maker claim. A checker must inspect the actual work and results; Work reviews are task-level attestations.
- **Recovery:** interrupted Work brief amendments and promotions use local pending records. Exact retries can finish valid interruptions; conflicting or corrupted state fails closed.
- **Forge isolation:** ordinary Work operations do not alter Forge state. Only an explicitly confirmed promotion creates a new Forge scope, with its own provenance link and fresh pending tasks.
- **Independent certification:** `/kyro:qa` is separate from executor review. Closing a sprint or completing a scope is a distinct, approval-gated action.

### Legacy debt remediation

Kyro **4.43.5 is origin-only**: `debt.origin.set` changes `origin` but cannot repair an entire legacy debt record. Kyro **4.44.0 and later**, including **6.1.0**, supports `debt.canonicalize` (remediation protocol v3) for a record with missing canonical fields or legacy-only keys. Protocol v5 also records post-close debt transitions so an owner can reconcile debt and complete a scope without changing historical checkpoints. The older `resolvedSprint` compatibility migration no longer runs during install, sync, or update. Nothing is migrated for you: upgrading never rewrites an existing scope, and closed-scope checkpoints remain immutable.

The explicit path is doctor → prepare → supply values → preview → apply with confirmation → doctor → recertify. Kyro does not guess `priority` or `targetSprint`; a suggestion is never an authorization. [Kyro Lens](https://github.com/synapsync/kyro-lens) verifies the resulting commitments read-only and does not repair them. See the [CLI remediation guide](docs/cli.md) and [release checklist](docs/release-checklist.md).

## Documentation

| Guide | What it covers |
| --- | --- |
| [Getting started](docs/getting-started.md) | Initial installation and Forge scope |
| [Work](docs/work.md) | Complete Work CLI lifecycle and promotion |
| [CLI](docs/cli.md) | Tool-owned verbs, invocation, upgrades, and remediation |
| [Agent adapters](docs/agent-adapters.md) | Claude, Codex, OpenCode, and other hosts |
| [Teams](docs/teams.md) | Shared versus personal state and clone bootstrap |
| [Architecture](docs/architecture.md) | Components, storage, and data flow |
| [Maker/checker](docs/maker-checker.md) | Evidence and review responsibilities |
| [Sprint checkpoints](docs/sprint-close-checkpoints.md) | Lossless Forge closure and recovery |
| [MCP](docs/mcp.md) · [Trace](docs/trace.md) · [Evals](docs/evals.md) | Structured tools and diagnostics |

## Develop Kyro

```bash
git clone https://github.com/SynapSync/kyro-ai.git
cd kyro-ai
npm ci
npm run build
npm run check
npm run check:adapters
npm pack --dry-run
```

The build output must match source (`npm run check:dist`). Use `node dist/cli.js` to test a checkout without changing the globally installed runtime. Release metadata in `package.json`, `package-lock.json`, and `WORKFLOW.yaml` must agree. See the [release checklist](docs/release-checklist.md).

Licensed under [Apache-2.0](LICENSE). [Report an issue](https://github.com/SynapSync/kyro-ai/issues).
