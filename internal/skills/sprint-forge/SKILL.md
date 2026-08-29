---
name: sprint-forge
description: >
  Adaptive sprint workflow with a single source of truth per scope (sprint.json),
  lean context loading, formal debt tracking, and lossless sprint-close checkpoints.
license: Apache-2.0
metadata:
  author: synapsync
  version: "4.0"
  scope: [root]
  auto_invoke:
    - "Analyze project or codebase"
    - "Audit code quality or architecture"
    - "Create a roadmap for a project"
    - "Generate the next sprint"
    - "Execute a sprint"
    - "Check project status or progress"
    - "Review technical debt"
    - "Analiza el proyecto o codebase"
    - "Audita la calidad o arquitectura del código"
    - "Crea un roadmap para el proyecto"
    - "Genera el siguiente sprint"
    - "Ejecuta el sprint"
    - "Estado del proyecto o progreso"
    - "Revisa la deuda técnica"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Task
---

# Kyro Sprint Forge — Runtime Contract (v4)

One scope = one `sprint.json`. Agents read project state + its lean pack, then route on `nextAction`. No agent-facing files.

## Step 0 — Startup (MANDATORY, before anything else)

Run this before reading any other section and before writing any Kyro artifact. It is the same
handshake the orchestrator performs; it is repeated here in full because this skill is invocable on
its own (`kyro-ai:sprint-forge`), and on that path the orchestrator is never loaded.

1. **Resolve `{{KYRO_CLI}}`, once per session, before anything else below.** This token is normally
   substituted at install time by `npx kyro-ai install`/`sync`. If you are reading this from a channel
   that never ran that substitution (for example, installed as a Claude Code plugin from the
   marketplace), the literal 12 characters `{{KYRO_CLI}}` are still sitting in this file — resolve
   them yourself:
   - Run `kyro --version`. If it exits 0, `{{KYRO_CLI}}` means bare `kyro` for the rest of this session.
   - Else, check whether `~/.agents/kyro/current/dist/cli.js` exists. If it does, `{{KYRO_CLI}}` means
     `node ~/.agents/kyro/current/dist/cli.js`.
   - Else, Kyro's runtime is not installed on this machine. STOP — tell the user to run
     `npx kyro-ai@latest install --scope workspace --init-workspace --yes` once, then retry. This is
     not a license to hand-edit `sprint.json` or improvise; same rule as a missing verb in Step 4.
   Substitute the resolved value mentally everywhere `{{KYRO_CLI}}` appears in this or any other loaded
   skill asset for the rest of the session — never run the literal 12 characters `{{KYRO_CLI}}`.
2. Read `.agents/kyro/project.json` + `.agents/kyro/local.json`. Unreadable/corrupt → stop here.
3. Resolve the scope from user input, `local.json.activeScope`, or the only directory under
   `.agents/kyro/scopes/`. Ambiguous or none → ask the user before continuing.
4. Silently run `{{KYRO_CLI}} repair integrity prepare --kyro-scope <scope> --json` before
   `context-pack`, using the scope resolved above. Never omit `--kyro-scope` here — it isolates this
   scope from unrelated drift. Findings/blockers → load `modes/recover.md` and stop. None → continue.
5. **Capability handshake:** run `{{KYRO_CLI}} capabilities --json`. Unknown command, handshake
   failure, or a missing tool-owned verb (`record-evidence` included) means the runtime is unusable: ABORT without mutating Kyro
   state. Report the observed output of `{{KYRO_CLI}} --version` (or `not installed`) and the exact
   remedy `npx kyro-ai@latest sync --scope workspace --yes`. Never work around it by hand.
6. Resolve routing with `{{KYRO_CLI}} context-pack --kyro-scope <scope> --json` (lean pack:
   `nextAction`, `nextTaskId`, `reviewPending`, `conventions`, budget). Do not open the full
   `sprint.json` to route. No `sprint.json` → INIT.
7. Load the single mode named by the pack's `nextAction` (see Routing below).

**If Step 0 did not complete, no Kyro artifact gets written.** A CLI you could not resolve, a failed
handshake, or a missing runtime are all STOP conditions — never a reason to hand-author `sprint.json`,
`project.json`, or `local.json`. Claude Code may add a `PreToolUse` defense, but that host-specific hook
is reinforcement only; the portable guarantee is this fail-closed CLI contract.

## Core Invariants

1. `sprint.json` is the single source of truth; one file to update per action (see Read Path Contract).
2. Route on the pack's `nextAction` (mirrors `handoff.nextAction`); never infer from file presence.
3. Generate one sprint; never pre-generate.
4. Tasks are self-contained: every task carries `description`, `files_to_touch`, `context`, `acceptance_criteria`.
5. Debt never disappears; it only changes `status` (`open → in_progress → resolved | deferred`).
6. Closing a sprint is owned by `{{KYRO_CLI}} close-sprint` — never null `activeSprint` by hand; it becomes one `ledger[]` entry.
7. Findings/archives are write-only evidence; never re-read to route.
8. **Admit unknowns, never guess.** Write `[NEEDS CLARIFICATION: <gap>]` and route to `clarify`. `{{KYRO_CLI}} doctor`/`analyze` FAIL while any marker remains.
9. **Tool-owned verbs require a CLI that exposes them** (Startup handshake). A missing verb means the runtime is too old — abort; never fall back by hand.

## Read Path Contract (context-pack first) — MANDATORY

The full `sprint.json` is ~10–20k tokens. Never open it to route/execute/review or brief status — read the lean pack (`{{KYRO_CLI}} context-pack --kyro-scope <scope> --json`; `--task[ <id>]` for execute/review). Open the full file only when `plan_sprint`/`close_sprint`/status-full needs its planning or reporting context; agents never open it in order to write it.

## Artifact Write Contract (MANDATORY)

Every mutation of `sprint.json`, project state, checkpoints, or `archive/` MUST be owned by a CLI verb.
The CLI validates, locks, writes, and re-verifies the affected state internally. Agents must not
substitute an editor, patch, or ad-hoc script. If a required state-changing verb is absent, stop and
report the observed runtime version plus `npx kyro-ai@latest sync --scope workspace --yes`.

## Tool-owned operations (use the CLI, do not hand-roll)

Irreversible or schema-critical operations are CLI-owned, never hand-rolled:

| Command | What it owns |
|---------|--------------|
| `{{KYRO_CLI}} close-sprint --kyro-scope <scope> --outcome <...>` | Lossless close: publishes the checkpoint, snapshots into `ledger[]`, reconciles state. |
| `{{KYRO_CLI}} doctor --artifacts --kyro-scope <scope>` | Validates shape drift, checkpoint state/digests/artifacts, legacy snapshots, and unresolved `[NEEDS CLARIFICATION]`. |
| `{{KYRO_CLI}} analyze --kyro-scope <scope>` | Semantic cross-check (clarity, coverage, deps, debt, principles); non-zero on CRITICAL/HIGH. Gate before close. |
| `{{KYRO_CLI}} repair --kyro-scope <scope>` | Normalizes `sprint.json` formatting. |
| `{{KYRO_CLI}} clarify --from <file> --kyro-scope <scope>` | Records one or more accepted clarification decisions and safely advances routing when clear. |
| `{{KYRO_CLI}} rule add ... [--global]` | Adds a scope rule; `--global` also writes `project.json` after approval. |

Claude Code's `PreToolUse` hook adds host-specific defense against manual managed-state writes. Other
hosts may not expose an equivalent hook, so correctness never depends on it.

## Routing (handoff.nextAction → mode)

| nextAction | Load |
|------------|------|
| `init` (no sprint.json) | `modes/INIT.md` + one `helpers/analysis/{workType}.md` |
| `clarify` | `modes/clarify.md` |
| `plan_sprint` | `modes/SPRINT.md`, `modes/plan-sprint.md`, then `helpers/sprint-generator.md` |
| `execute_task` | `modes/SPRINT.md`, `modes/execute-task.md` |
| `review_task` | `modes/SPRINT.md`, `modes/review-task.md`, `helpers/reviewer.md` |
| `close_sprint` | `modes/SPRINT.md`, `modes/close-sprint.md`, `helpers/debt-tracker.md` + `helpers/learner.md` as needed |
| `done` | Stop — scope complete. No work mode. |
| status report | `modes/STATUS.md` |
| inconsistent | `modes/recover.md` |

Templates are loaded only immediately before writing their artifact.

## Principles, conventions, ADRs

- `principles[]` in `project.json`: authored gates; `non-negotiable` blocks.
- `conventions[]`: scope rules live in `sprint.json`; approved globals also live in `project.json`. Use `{{KYRO_CLI}} rule add [--global]`.
- `adrs[]` in `sprint.json`: durable scope architecture decisions with tradeoffs.

## Artifact Contract

| File | Role |
|------|------|
| `.agents/kyro/project.json` | Shared registry: `scopes[]`, optional `principles[]`, optional global `conventions[]` |
| `.agents/kyro/local.json` | Personal state: `activeScope`, installed adapters, execution preferences |
| `.agents/kyro/scopes/{scope}/sprint.json` | Single source of truth (see template) |
| `.agents/kyro/scopes/{scope}/archive/sprint-NNN-slug.md` | Human narrative at close (write-only) |
| `.agents/kyro/scopes/{scope}/archive/sprint-NNN-slug.json` | Verbatim snapshot of the closed sprint (write-only) |
| `.agents/kyro/scopes/{scope}/archive/sprint-NNN-slug.checkpoint.json` | Versioned lossless checkpoint (before/after state, write-only) |
| `.agents/kyro/scopes/{scope}/findings/NN-slug.md` | INIT analysis evidence (write-only) |

## Boundaries

- INIT is read-only against source code until it writes Kyro artifacts.
- Execution may modify code/docs but must validate touched areas before marking a task done.
- STATUS is read-only unless explicitly mutating debt status.
- Recover preserves user archives and rebuilds `sprint.json` from the best evidence.
