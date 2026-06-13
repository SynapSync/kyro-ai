# Agent Adapters

Kyro is an agent-agnostic workflow kit. Native platform behavior depends on whether the host agent supports commands, project rules, skills, or plugin manifests. The portable interface is always the same: markdown instructions plus `.agents/kyro/scopes/{scope}/` artifacts.

---

## Stable Interface

Treat these files and directories as Kyro's public interface:

| Interface | Purpose |
|-----------|---------|
| `agents/orchestrator.md` | Full workflow coordinator instructions |
| `skills/core/SKILL.md` | Sprint planning, execution, status, debt, and re-entry workflow |
| `skills/qa-review/SKILL.md` | Senior QA, architecture, security, and sprint alignment review |
| `commands/*.md` | Native slash-command semantics where supported |
| `.agents/kyro/scopes/{scope}/` | Project roadmap, findings, phases, handoffs, rules, and re-entry prompts |

Platforms without slash commands should invoke these equivalent intents:

| Intent | Equivalent request |
|--------|--------------------|
| `forge` | Analyze, plan, execute, review, and close the sprint |
| `status` | Read artifacts and report project progress/debt |
| `wrap-up` | Close the session and update re-entry prompts |

---

## Generic Setup

Copy or symlink Kyro into the target project:

```bash
mkdir -p .skills .agents .agents/kyro/scopes

cp -r /path/to/kyro-ai/skills/core .skills/
cp -r /path/to/kyro-ai/skills/qa-review .skills/
cp /path/to/kyro-ai/agents/orchestrator.md .agents/
```

Use this onboarding prompt for any agent:

```text
Use Kyro as the workflow for this project.

Read these files first:
- .agents/orchestrator.md
- .skills/core/SKILL.md
- .skills/qa-review/SKILL.md

Persist workflow artifacts under:
- .agents/kyro/scopes/{scope}/

If native slash commands are unavailable:
- forge = analyze/plan/execute/review/close
- status = read artifacts and report progress/debt
- wrap-up = close session and update re-entry prompts
```

---

## Claude Code Adapter

Claude Code has a native adapter through `.claude-plugin/`.

```bash
/plugin marketplace add SynapSync/kyro-ai
/plugin install kyro-ai@kyro-ai
```

The Claude adapter registers commands, the orchestrator agent, and skills. It is the only native adapter included in this repository today.

---

## Codex Adapter

Codex-style agents should use Kyro as project context:

```bash
mkdir -p .skills .agents
cp -r kyro-ai/skills/core .skills/
cp -r kyro-ai/skills/qa-review .skills/
cp kyro-ai/agents/orchestrator.md .agents/
```

Prompt:

```text
Read .agents/orchestrator.md and the Kyro skills in .skills/.
Use the forge intent for this scope: {scope}.
Persist outputs under .agents/kyro/scopes/{scope}/.
```

Native command registration depends on the Codex environment. If slash commands are unavailable, use the manual intent names.

---

## OpenCode Adapter

OpenCode usage is manual unless your environment supports project-level rule files.

```bash
mkdir -p .skills .agents
cp -r kyro-ai/skills/core .skills/
cp -r kyro-ai/skills/qa-review .skills/
cp kyro-ai/agents/orchestrator.md .agents/
```

Reference the files in the AI panel:

```text
@file .agents/orchestrator.md
@file .skills/core/SKILL.md
@file .skills/qa-review/SKILL.md

Run the status intent for .agents/kyro/scopes/{scope}/.
```

---

## Cursor Adapter

Cursor can use Kyro through project rules and referenced files.

Recommended setup:

1. Copy the Kyro files using the generic setup.
2. Add a Cursor project rule that tells the agent to read `.agents/orchestrator.md`.
3. Ask Cursor to persist sprint artifacts under `.agents/kyro/scopes/{scope}/`.

Cursor prompt:

```text
Use Kyro for this task. Read .agents/orchestrator.md and the skills under .skills/.
Run the forge intent for {scope}. Do not create a custom planning format.
```

---

## Model Guidance

Kyro does not route or enforce model selection.

- Use the strongest available model for implementation, debugging, and architecture decisions.
- Lighter/faster models are acceptable for read-only analysis, status reports, and documentation review.
- When the platform supports model overrides, choose per task rather than encoding model names into Kyro artifacts.

---

## Compatibility Rule

Do not add platform-specific behavior to the core workflow unless the behavior works through markdown artifacts or is isolated in an adapter-specific directory.
