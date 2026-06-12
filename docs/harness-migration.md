# Harness Migration — Multi-Agent Runtime Direction

Kyro is evolving from a markdown-heavy workflow into an installable harness for AI-assisted software delivery. The goal is not to abandon existing adapters. The goal is to make Kyro practical across Claude, Codex, OpenCode, Cursor, and generic agent environments with one consistent operating model.

## Current Problem

Kyro currently works best where a host can load its plugin, commands, agents, and skills directly. Outside that environment, teams must manually copy or install pieces of the workflow and ask each agent to interpret large markdown instructions.

That creates predictable issues:

- agents consume too many tokens before doing useful work
- validation depends too much on prose discipline
- state is reconstructed from markdown instead of queried from a structured source
- install/setup differs per agent
- health checks are not available as a first-class runtime command

Plan A stabilizes the current package first: version checks, link checks, package health checks, and command/orchestrator deduplication. Track B builds the harness runtime on top of that stable base.

## Target Direction

Kyro should become a **multi-agent harness** with:

- a small CLI/runtime that owns deterministic checks and state operations
- thin adapter prompts for each supported agent
- markdown artifacts that remain human-readable and git-friendly
- structured sidecar state for things agents should not parse from prose
- first-class support for both Claude plugin workflows and non-Claude agents

Claude plugin support remains a supported adapter. It should not be treated as legacy or removed just because Kyro adds a CLI and additional adapters.

## Adapter Model

Kyro should support multiple agent surfaces through adapter-specific packaging:

| Adapter | Expected Role |
| --- | --- |
| Claude plugin | First-class native plugin experience with commands, agents, and skills |
| Codex | Project instructions and CLI-backed workflow commands |
| OpenCode | Project-local context plus CLI-backed status, checks, and artifacts |
| Cursor | Project rules plus CLI-backed workflow state |
| Generic agents | Minimal `KYRO.md` bootstrap plus CLI/runtime commands |

The stable contract across all adapters is:

1. use Kyro artifact paths consistently
2. let deterministic code validate package and project health
3. keep large workflow detail out of always-loaded prompts
4. preserve markdown as the collaborative human interface

## Runtime Responsibilities

The future runtime should own behavior that is currently too fragile as prose:

- package diagnostics: versions, links, missing assets, invalid manifests
- project diagnostics: artifact layout, sprint state, debt consistency
- state queries: current scope, current sprint, next recommended action
- rendering: structured state to markdown views
- install scaffolding: agent-specific bootstrap files

The agent should still do the creative and engineering work: analysis, implementation, review, and decision-making. The harness should make that work observable, repeatable, and easier to validate.

## Non-Goals for Plan A

Plan A does not implement the CLI runtime.

Plan A does not replace the Claude plugin.

Plan A does not redesign sprint-forge behavior.

Plan A only prepares the repository so Track B can build the harness from a stable, tested baseline.

## Track B Starting Point

Track B should begin with the smallest useful runtime:

```bash
kyro doctor
kyro init --agent <claude|codex|opencode|cursor|generic>
kyro status --json
```

Recommended first implementation order:

1. `kyro doctor` for package/project health checks
2. `kyro init --agent generic` for universal bootstrap
3. adapter-specific init templates for Claude, Codex, OpenCode, and Cursor
4. structured `state.json` sidecar for sprint/debt/status metadata
5. markdown rendering from structured state where safe

This keeps Kyro portable without forcing every agent to load the whole workflow into context.
