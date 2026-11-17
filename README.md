# Kyro AI

[![npm](https://img.shields.io/npm/v/kyro-ai)](https://www.npmjs.com/package/kyro-ai) [![CI](https://github.com/SynapSync/kyro-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/SynapSync/kyro-ai/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENSE)

**A workflow for AI coding agents where the agent proposes and a CLI decides what gets written.**

An agent that plans in a chat window forgets the plan when the session ends, marks its own work as done, and leaves nothing a second person can check. Kyro moves the plan, the evidence and the review out of the conversation and into the repository, behind a command-line tool that validates every change to that state.

- **State lives in the project.** Plans, tasks, evidence, reviews and debt are JSON and Markdown under `.agents/kyro/`, committed with the code.
- **The CLI owns the writes.** Agents call `kyro` verbs; the CLI checks the schema and the transition, takes a lock, and writes. Hand edits are detected.
- **Makers do not approve themselves.** Recorded evidence is a claim. A separate review, and optionally an independent QA pass, decides whether it holds.
- **Closed work stays closed.** Closing a sprint writes a checkpoint with SHA-256 digests of the scope before and after, plus the git range of the code.
- **One install, several hosts.** Claude Code, Codex, OpenCode and Pi use the same skills and the same state.

## Quick start

Requires Node.js 18 or newer and Git. Run this from the root of the project where you want Kyro:

```bash
npm install -g kyro-ai
kyro install --init-workspace --yes
kyro doctor --artifacts
```

Then ask your agent for an outcome through one of the two workflows:

```text
/kyro-forge Add OAuth login with Google and GitHub
/kyro-work  Fix the price rounding bug in the checkout total
```

That is the Claude Code spelling; see [Supported hosts](#supported-hosts) for the others. The agent plans, stops at the approval gates, implements, records evidence and asks for review. You can stop at any point and continue in a fresh session with `/kyro-task-context`: the state is on disk, not in the chat.

## How it works

```text
you ──► agent command (/kyro-forge, /kyro-work)
              │  reads a context pack built from project state
              ▼
        agent proposes: plan, evidence, verdict
              │  kyro plan · record-evidence · review · close-sprint
              ▼
        kyro CLI validates schema and transition, locks, writes
              │
              ▼
        .agents/kyro/   plans, tasks, evidence, reviews, debt, checkpoints
```

The agent never edits `sprint.json` or `work.json` directly. Each verb is revision-bound, so a stale or conflicting write is refused instead of merged, and an interrupted transaction is either finished by an exact retry or fails closed.

## Two workflows

You choose the workflow explicitly. Neither is selected by the size or difficulty of the job.

| | Forge | Work |
| --- | --- | --- |
| Start with | A scope and a sprint plan | A Markdown brief and an explicit task plan |
| Flow | Scope → sprint → tasks → reviews → QA or close → checkpoint | Brief → tasks → evidence → reviews → close or promote |
| State | `.agents/kyro/scopes/<scope>/sprint.json` | `.agents/kyro/work/<id>/brief.md` and `work.json` |
| Choose it when | You want sprint checkpoints, a roadmap, tracked debt and independent certification | You want one task-driven piece of work with dependencies, amendments and its own closure |
| Entry point | `/kyro-forge` | `/kyro-work` |

Work is not limited to small jobs. A Work can later be promoted into a **new** Forge scope through an explicit, recoverable CLI transaction. Promotion transfers the selected unfinished tasks, not their approvals: the Forge tasks start pending and go through Forge's own review and QA. It does not change the active Forge scope. See the [Work guide](docs/work.md).

Before either path, `/kyro-idea` can mature a rough idea into a plan. It does not choose or create a scope or a Work for you.

Work can also be driven from the shell:

```bash
kyro work create --id search-refresh --from brief.md --dry-run --json
kyro work create --id search-refresh --from brief.md --json
kyro work status --work search-refresh --json
kyro work context-pack --work search-refresh --json
```

## Footprint

The CLI stays out of the way: no runtime dependencies, a 0.7 MB package, and `kyro --version` returns in about 35 ms. A workflow adds steps, so it adds agent turns and tokens; for a one-line fix with a clear test, skip it. Use Kyro when the work spans sessions or people, or when someone has to be able to check it later.

## Supported hosts

One `kyro install` publishes canonical skills under `~/.agents/skills/` and projects them to every detected host.

| Host | Invoke Work as | How it gets the skills |
| --- | --- | --- |
| Claude Code | `/kyro-work` | Native skills linked under `~/.claude/skills/` |
| Codex | `kyro-work` | Reads the canonical skills directly |
| OpenCode | `/kyro/work` | Native skills and slash commands |
| Pi | `/skill:kyro-work` | Reads the canonical skills directly |

The other commands follow the same pattern. Manage hosts per machine:

```bash
kyro adapters list
kyro adapters disable claude              # persistent opt-out; keeps the canonical skills
kyro adapters enable codex --integrations # also write the Codex MCP and AGENTS.md blocks
kyro doctor --adapters
```

Config integrations are opt-in: without `--integrations`, a fresh install does not touch a host's own configuration. If you used the old Claude Kyro plugin, check the new skills and then disable the plugin yourself; Kyro never changes plugin settings. Details are in [Agent adapters](docs/agent-adapters.md).

## Commands

Agent commands guide the agent. The CLI makes the deterministic state changes.

| Agent command | Purpose |
| --- | --- |
| `/kyro-forge` | Plan, execute, review and close a Forge sprint, or complete a finished scope |
| `/kyro-work` | Run the Work lifecycle you selected |
| `/kyro-idea` | Mature an idea before choosing a workflow |
| `/kyro-status` | Read progress, roadmap and debt |
| `/kyro-task-context` | Write a handoff prompt for a fresh session |
| `/kyro-qa` | Audit a scope and its implementation independently of the executor |
| `/kyro-scope-retire` | Retire an obsolete scope through a separate human-gated operation |

| CLI | Purpose |
| --- | --- |
| `kyro status` · `kyro context-pack` | Read-only view of a scope, and the context package an agent starts from |
| `kyro plan` · `record-evidence` · `review` · `close-sprint` | The Forge write path |
| `kyro work <subcommand>` | The Work write path |
| `kyro debt` · `adr` · `rule` · `scenario` · `clarify` | Tracked debt, decisions, conventions and requirements |
| `kyro doctor [--artifacts] [--adapters] [--tokens]` | Diagnose the install, the artifacts and the prompt budgets |
| `kyro capabilities --json` | The verbs this installed runtime supports |
| `kyro update` · `sync` · `uninstall` | Maintain the install |

The state verbs accept `--json` for a machine-readable envelope, and mutating verbs accept `--dry-run` where a preview makes sense. Check `kyro capabilities --json` before relying on a verb: an older installed runtime does not gain new ones because a repository was built. See the [CLI reference](docs/cli.md) and the [commands reference](docs/commands-reference.md).

## Project state and teams

```text
.agents/kyro/
├── project.json        # shared project policy; commit
├── local.json          # your active scope and local settings; ignored
├── scopes/<scope>/     # Forge sprint state and close archives; commit
└── work/<id>/          # Work brief, state and history; commit
```

Kyro writes its own `.agents/kyro/.gitignore`, which excludes local state, locks and pending-transaction scratch. Each team member runs `kyro install` in their own clone and picks their own active scope with `kyro scope set-active <scope> --yes`. Host choices are per machine, in `~/.agents/kyro/adapters.json`. See the [teams guide](docs/teams.md).

The runtime lives at `~/.agents/kyro/current/` and is not a project file. `kyro uninstall` removes workspace assets and keeps the machine install; `kyro uninstall --machine` removes Kyro's skills, projections, integration blocks and registry.

Checkpoints that record a sprint's git range (`close.git`, written since 6.5.0) cannot be verified by older runtimes, so teams that share scopes should set `team.minPackageVersion`; see [Sprint git range](docs/sprint-close-checkpoints.md#sprint-git-range).

## What Kyro guarantees, and what it does not

- **It guarantees the record.** `sprint.json` and `work.json` have validated schemas and transitions, and only CLI verbs write them. A checkpoint commits to its content with SHA-256, so a later edit to a closed sprint is detectable.
- **It does not prove the work is correct.** A recorded command with a `passed` result is the maker's claim. A passing review is a checker's attestation, not proof that tests ran. `/kyro-qa` is a separate, independent audit, and closing a sprint or completing a scope is its own approval-gated action.
- **It recovers without guessing.** An interrupted amendment or promotion leaves a pending record. An exact retry finishes a valid interruption; conflicting or corrupted state fails closed.
- **It keeps the workflows apart.** Work operations do not alter Forge state. Only a confirmed promotion creates a new Forge scope, with a provenance link and fresh pending tasks.
- **Its tamper evidence has a boundary.** Someone who can rewrite both a checkpoint and its entry in the live ledger can replace both. If you need adversarial authenticity, protect history with signed commits as well; see [Sprint checkpoints](docs/sprint-close-checkpoints.md).

## Upgrading

`kyro update` installs the latest release and refreshes the runtime and the workspace. Upgrading never rewrites an existing scope, `kyro doctor` diagnoses rather than repairs, and closed-scope checkpoints remain immutable. The [changelog](CHANGELOG.md) lists what changed in each version.

### Legacy debt remediation

Kyro **4.43.5 is origin-only**: `debt.origin.set` changes `origin` but cannot repair an entire legacy debt record. Kyro **4.44.0 and later**, including the current release **6.6.0**, supports `debt.canonicalize` (remediation protocol v3) for a record with missing canonical fields or legacy-only keys. Protocol v5 also records post-close debt transitions, so an owner can reconcile debt and complete a scope without changing historical checkpoints. Nothing is migrated for you.

The explicit path is doctor → prepare → supply values → preview → apply with confirmation → doctor → recertify. Kyro does not guess `priority` or `targetSprint`; a suggestion is never an authorization. [Kyro Lens](https://github.com/synapsync/kyro-lens) verifies the resulting commitments read-only and does not repair them. See the [CLI remediation guide](docs/cli.md) and the [release checklist](docs/release-checklist.md).

## Documentation

| Guide | What it covers |
| --- | --- |
| [Getting started](docs/getting-started.md) | First install and first Forge scope |
| [Work](docs/work.md) | The full Work lifecycle and promotion |
| [CLI](docs/cli.md) | Verbs, invocation, upgrades and remediation |
| [Agent adapters](docs/agent-adapters.md) | Claude Code, Codex, OpenCode, Pi and other hosts |
| [Teams](docs/teams.md) | Shared and personal state, clone bootstrap |
| [Architecture](docs/architecture.md) | Components, storage and data flow |
| [Maker/checker](docs/maker-checker.md) | Who records evidence and who reviews it |
| [Validation tiers](docs/validation-tiers.md) | Focused checks per task, the full suite at integration |
| [Sprint checkpoints](docs/sprint-close-checkpoints.md) | Lossless closure, the git range and recovery |
| [Cost model](docs/cost-model.md) | Prompt budgets per route and how they are kept |
| [MCP](docs/mcp.md) · [Trace](docs/trace.md) · [Evals](docs/evals.md) | Structured tools and diagnostics |

## Develop Kyro

```bash
git clone https://github.com/SynapSync/kyro-ai.git
cd kyro-ai
npm ci
npm run build
npm run check
```

`npm run check` runs every validation step in parallel and prints only the output of the steps that failed; it takes about two and a half minutes on eight cores. Narrow it while you work:

```bash
node scripts/run-checks.mjs --list
node scripts/run-checks.mjs --only flag --bail
npm run check:serial
```

Use `node dist/cli.js` to try a checkout without touching your installed runtime. Versions in `package.json`, `package-lock.json` and `WORKFLOW.yaml` must agree; the [release checklist](docs/release-checklist.md) has the rest.

Licensed under [Apache-2.0](LICENSE). [Report an issue](https://github.com/SynapSync/kyro-ai/issues).
