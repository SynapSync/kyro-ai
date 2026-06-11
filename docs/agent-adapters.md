# Agent Adapters

Kyro is an agent-agnostic workflow kit. Native platform behavior depends on whether the host agent supports commands, project rules, skills, or plugin manifests. The portable interface is always the same: markdown instructions plus `.agents/sprint-forge/{scope}/` artifacts.

Copy-and-customize templates live in [`adapters/`](../adapters/README.md).

**Canonical install** (all platforms):

```bash
npx @synapsync/kyro-workflow init
npx @synapsync/kyro-workflow init --cursor   # Cursor rule
npx kyro-workflow doctor
```

`npx skills add` installs skills only — not the full workflow. Use `init` for orchestrator, config, scripts, and `.kyro/install.json`.

---

## Stable Interface

Treat these files and directories as Kyro's public interface:

| Interface | Purpose |
|-----------|---------|
| `agents/orchestrator.md` | Full workflow coordinator instructions |
| `skills/sprint-forge/SKILL.md` | Sprint planning, execution, status, debt, and re-entry workflow |
| `skills/qa-review/SKILL.md` | Senior QA, architecture, security, and sprint alignment review |
| `commands/*.md` | Native slash-command semantics where supported |
| `config.json` | Gates, parallelism, harness capabilities, quality gates |
| `.agents/sprint-forge/{scope}/` | Project roadmap, findings, sprints, handoffs, rules, and re-entry prompts |

Platforms without slash commands should invoke these equivalent intents:

| Intent | Equivalent request |
|--------|--------------------|
| `forge` | Analyze, plan, execute, review, and close the sprint |
| `status` | Read artifacts and report project progress/debt |
| `wrap-up` | Close the session and update re-entry prompts |

---

## Harness Matrix

| Platform | Setup path | Slash commands | Hooks | Subagents | Guide |
|----------|------------|----------------|-------|-----------|-------|
| All | `npx @synapsync/kyro-workflow init` | Manual intents (except Claude plugin) | Manual `npm run check:*` | Config flag | [getting-started.md](getting-started.md) |
| Cursor | `init --cursor` or post-init rule | Manual intents | Optional example | Config flag | [HOW-TO-USE-CURSOR.md](HOW-TO-USE-CURSOR.md) |
| Codex | `init` | Host-dependent | Manual | Config flag | [HOW-TO-USE-CODEX.md](HOW-TO-USE-CODEX.md) |
| OpenCode | `init` + `@file` refs | Manual intents | Manual | Config flag | [HOW-TO-USE-OPENCODE.md](HOW-TO-USE-OPENCODE.md) |
| Kilo Code | `init` + `adapters/kilo-code/` prompts | Manual intents | Manual | Config flag | [HOW-TO-USE-KILO-CODE.md](HOW-TO-USE-KILO-CODE.md) |
| Claude Code | `init` **or** `/plugin install` | Native `/kyro-workflow:*` with plugin | PostToolUse | Native | [adapters/claude-code/README.md](../adapters/claude-code/README.md) |
| LLM API | `init` + load markdown into prompts | N/A | Your pipeline | Your runtime | [programmatic-usage.md](programmatic-usage.md) |

---

## Environment Variables

Scripts resolve paths in a harness-neutral way:

| Variable | Purpose | Legacy alias |
|----------|---------|--------------|
| `KYRO_PROJECT_DIR` | Consumer project root (git, sprint artifacts) | `CLAUDE_PROJECT_DIR` |
| `KYRO_PACKAGE_ROOT` | Installed Kyro package root (bundled scripts) | `CLAUDE_PLUGIN_ROOT` |

After `init`, scripts also read `.kyro/install.json` → `package_root` so env vars are optional.

---

## Harness Config

Set `config.json` → `harness` to match your host:

```json
"harness": {
  "id": "generic",
  "capabilities": {
    "slash_commands": false,
    "subagents": false,
    "post_edit_hooks": false,
    "project_memory": false
  },
  "enforcement": "manual"
}
```

| `enforcement` | Behavior |
|---------------|----------|
| `manual` | Agent runs `npm run check:post-edit` after edits (default, works everywhere) |
| `hooks` | Platform runs scans (Claude Code adapter, optional Cursor hooks) |

The orchestrator reads `harness.capabilities.subagents` before parallel INIT fan-out or isolated QA review.

To print a suggested `harness` block for the current host:

```bash
npm run kyro:harness-detect
```

Preview or apply only the `harness` section in the project `config.json`:

```bash
npm run kyro:harness-detect -- --dry-run
npm run kyro:harness-detect -- --apply
```

`--apply` never changes `gates`, `memory`, `sprint`, `parallelism`, or `quality_gates`.

---

## Generic Setup

Copy or symlink Kyro into the target project:

```bash
mkdir -p .skills .agents .agents/sprint-forge

cp -r /path/to/kyro-workflow/skills/sprint-forge .skills/
cp -r /path/to/kyro-workflow/skills/qa-review .skills/
cp /path/to/kyro-workflow/agents/orchestrator.md .agents/
cp /path/to/kyro-workflow/config.json .
```

Use `adapters/generic/onboarding-prompt.txt` or this prompt:

```text
Use Kyro as the workflow for this project.

Read these files first:
- .agents/orchestrator.md
- .skills/sprint-forge/SKILL.md
- .skills/qa-review/SKILL.md

Persist workflow artifacts under:
- .agents/sprint-forge/{scope}/

If native slash commands are unavailable:
- forge = analyze/plan/execute/review/close
- status = read artifacts and report progress/debt
- wrap-up = close session and update re-entry prompts

After code edits: npm run check:post-edit
Before commit: npm run check:pre-commit
```

---

## Cursor Adapter

See [HOW-TO-USE-CURSOR.md](HOW-TO-USE-CURSOR.md). Copy `adapters/cursor/kyro-workflow.mdc` to `.cursor/rules/`.

---

## Codex Adapter

See [HOW-TO-USE-CODEX.md](HOW-TO-USE-CODEX.md).

---

## OpenCode Adapter

See [HOW-TO-USE-OPENCODE.md](HOW-TO-USE-OPENCODE.md).

---

## Kilo Code Adapter

See [HOW-TO-USE-KILO-CODE.md](HOW-TO-USE-KILO-CODE.md).

---

## Claude Code Adapter

Claude Code has a native adapter through `.claude-plugin/`. This is **optional** — the same core files work on every other harness.

```bash
/plugin marketplace add SynapSync/kyro-workflow
/plugin install kyro-workflow@kyro-workflow
```

The Claude adapter registers commands, the orchestrator agent, skills, and thin hook adapters for deterministic checks.

PostToolUse hooks invoke bundled scripts through the plugin root:

```json
{
  "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/post-edit-hook.js\""
}
```

The hook wrapper resolves `KYRO_PACKAGE_ROOT` / `CLAUDE_PLUGIN_ROOT`, then runs `post-edit-scan.js` against `KYRO_PROJECT_DIR` / `CLAUDE_PROJECT_DIR` (or cwd).

Recommended Claude Code harness config:

```json
"harness": {
  "id": "claude-code",
  "capabilities": {
    "slash_commands": true,
    "subagents": true,
    "post_edit_hooks": true,
    "project_memory": true
  },
  "enforcement": "hooks"
}
```

Portable scripts (all harnesses):

| Script | Purpose |
|--------|---------|
| `npm run check:post-edit` | Scan changed and untracked files for debug artifacts and likely secrets |
| `npm run check:pre-commit` | Run configured quality gates and the post-edit scan before commit |
| `npm run check:versions` | Verify package, lockfile, plugin manifest, and workflow versions match |
| `npm run kyro:sprint-number -- <scope>` | Resolve the next sprint number for a Kyro scope |
| `npm run kyro:debt-inherit -- <previous> <current>` | Verify debt rows are inherited from one sprint to the next |
| `npm run kyro:metrics -- <scope>` | Aggregate sprint progress and estimate/actual metrics |

---

## Programmatic Adapter

See [programmatic-usage.md](programmatic-usage.md) for loading Kyro markdown into any LLM API.

---

## Model Guidance

Kyro does not route or enforce model selection.

- Use the strongest available model for implementation, debugging, and architecture decisions.
- Lighter/faster models are acceptable for read-only analysis, status reports, and documentation review.
- When the platform supports model overrides, choose per task rather than encoding model names into Kyro artifacts.

---

## Compatibility Rule

Do not add platform-specific behavior to the core workflow unless the behavior works through markdown artifacts or is isolated in `adapters/` or `.claude-plugin/`.
