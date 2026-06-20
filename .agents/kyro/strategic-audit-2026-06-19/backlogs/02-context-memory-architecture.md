# Backlog: Context and Memory Architecture

Kyro has the right conceptual model: Markdown for durable evidence, JSON summaries for routing, rules for persistent learning, and re-entry prompts for recovery. This backlog makes those layers explicit and queryable.

## Evidence

- `state.json`, `index.json`, `ROADMAP.summary.json`, sprint summaries, and debt summaries exist as structured routing files.
- `rules/context-persistence.md` and `skills/sprint-forge/assets/helpers/reentry-generator.md` describe recovery and re-entry behavior.
- The CLI can inspect scopes and repair JSON from Markdown, but it does not yet expose a unified context/memory contract.

## Technical correction

Define a context contract that separates persistent, temporary, and on-demand context. Make the contract visible in schemas, commands, docs, and tests.

## Tasks

| ID | Priority | Size | Task | Likely files | Acceptance criteria | Validation |
|----|----------|------|------|--------------|---------------------|------------|
| CMA-001 | P1 | S | Define context taxonomy document | `docs/context-architecture.md` | Documents persistent, temporary, on-demand, derived, and disposable context layers | Link check |
| CMA-002 | P1 | M | Add context metadata to `index.json` | `src/cli/artifacts/schema.ts`, templates, repair logic | Index records relevant artifact paths, summary freshness, and context-pack hints | Artifact fixture tests |
| CMA-003 | P1 | M | Add source hash/mtime metadata to summaries | `src/cli/artifacts/schema.ts`, `src/cli/commands/repair.ts`, templates | Summaries can prove which Markdown version they summarize | `check:artifact-fixtures` |
| CMA-004 | P1 | S | Encode rules loading in context-pack | context-pack command | Context pack includes relevant rules path and whether rules were loaded/found | Context-pack fixture |
| CMA-005 | P2 | M | Add decisions artifact convention | `docs/decisions.md` or `docs/adr-template.md`, templates | Decisions have durable IDs and are referenced by context packs when relevant | Markdown validation |
| CMA-006 | P2 | L | Add cross-scope memory query command | future CLI command | Can list known scopes, decisions, risks, and open debt without reading all Markdown | Fixture with multiple scopes |

## Design constraints

- Do not duplicate full Markdown content into JSON.
- JSON stores routing facts and short summaries only.
- Markdown remains the durable human-readable evidence.
- Context packs are generated views, not new sources of truth.
