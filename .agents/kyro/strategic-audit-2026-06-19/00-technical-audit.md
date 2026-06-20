# Kyro AI Strategic Optimization Technical Audit

Kyro AI is already moving in the right direction: a portable workflow harness with command routers, adapter projections, Markdown evidence, JSON routing state, and deterministic CLI checks. This document began as the June 19 baseline and was revalidated on 2026-06-20 after the P0 reproducibility scope and lean runtime cost refactor.

## Executive Summary

Kyro does not need a vector database, knowledge graph, or extra autonomous agents by default. Its highest-return path remains moving repeatable behavior into the CLI while leaving analysis, judgment, and implementation to the agent.

**2026-06-20 status:** the original P0 reproducibility drift is resolved. `dist/` freshness is enforced by `npm run check:dist`, adapter fixtures run in CI, release validation includes token/artifact checks and `npm pack --dry-run`, package/plugin/workflow versions are synchronized at `3.4.2`, and `kyro-ai@3.4.2` is published. The current highest-risk remaining items are context-pack generation, exported artifact schemas, summary refresh outside repair, documentation ownership, and observability reports.

## Current System Understanding

```text
User
  -> kyro/kyro-ai CLI
  -> installs global runtime under ~/.agents/kyro/current
  -> projects command skills and adapter-specific entrypoints
  -> host agent reads command stub
  -> router reads .agents/kyro/kyro.json, state.json, and index.json first
  -> mode/helper/template loads on demand
  -> Markdown evidence and JSON summaries are updated
  -> doctor/repair/sync validate or reconstruct state
```

## Deterministic vs LLM Responsibilities

| Layer | Deterministic today | LLM-driven today | Recommended direction |
|-------|---------------------|------------------|-----------------------|
| CLI | install, sync, uninstall, doctor, repair, scope, detect, dist freshness check, token runtime path audit, artifact doctor | None | Add context packs, exported schemas, summary refresh, doc impact, metrics reports |
| Adapters | project command stubs, managed blocks, settings overlays | Host agent interpretation | Keep stubs thin; validate generated projections |
| Commands | route to modes | Agent follows router | Keep commands as route selectors only |
| Skills | workflow rules, templates, helpers | Agent reads and applies instructions | Deduplicate repeated prose and make rules checkable |
| Artifacts | JSON summaries/state validation, `rules.index.json`, optional `events.ndjson` validation | Markdown creation and sprint-close materialization | Markdown remains evidence; JSON remains routing cache; events remain compact execution evidence |

## Key Problems Identified

| Priority | Problem | Evidence | Impact |
|----------|---------|----------|--------|
| DONE | Stale `dist/` relative to `src/` | `npm run check:dist` passes and proves generated output matches current `src/` | Reproducibility drift is now guarded |
| DONE | Adapter fixture checks missing from CI | `.github/workflows/ci.yml` validation runs `npm run check:adapters` after build | Adapter regressions are now covered by the release gate |
| P1 | Artifact schemas are TypeScript-only | `src/cli/artifacts/schema.ts` validates runtime shape, but no exported JSON Schema contract | Agents/templates cannot validate output generically |
| P1 | Context packs are implicit, not generated | Routers describe read order, but CLI cannot emit a minimal task context package | Agents repeat exploration and overshare context |
| P1 | Documentation ownership is not formalized | Docs and artifacts lack consistent `source_of_truth`, `derived_from`, and validator metadata | Markdown drift is hard to detect |
| P1 | Summary refresh is coupled to repair | `repair` reconstructs summaries, but no first-class happy-path refresh command exists | Agents may leave stale JSON caches |
| PARTIAL | Observability is mostly final-state based | Optional `events.ndjson` shape and artifact validation now exist, but no event writer or metrics command exists | Debugging agent failures is better supported, but reporting is still manual |
| P2 | Model routing is guidance, not contract | Docs mention cheaper/stronger models, but no manifest maps task type to budget/model tier | Cost control relies on discipline |

## Token and Cost Optimization Opportunities

Kyro now has a stronger progressive-disclosure base: small command routers, slim orchestrator/skill runtime contracts, mode-gated assets, structured summaries, realistic runtime token-path audits, and forbidden-helper assertions in `doctor --tokens`. The next technical step is to make context selection a CLI output rather than a prompt convention.

| Opportunity | Technical correction | Expected effect | Priority |
|-------------|----------------------|-----------------|----------|
| Generate context packs | `kyro context-pack --kyro-scope <scope> --task <id>` | Less repeated file loading | P1 |
| Deduplicate route/gate prose | Mostly completed for eager runtime; continue avoiding duplication in docs | Lower startup tokens and less drift | DONE/P1 |
| Track route token estimates | Runtime route estimates are enforced in `doctor --tokens`; context-pack estimates remain pending | Measurable cost baseline | PARTIAL/P1 |
| Tool/result cache metadata | Store summary hashes and source mtimes | Avoid unnecessary Markdown reads | P2 |
| Model routing manifest | Map task type to context budget and model tier | Lower cost for status/classification tasks | P2 |

## Context and Memory Architecture

| Context type | Storage | Lifetime | Retrieval mode |
|--------------|---------|----------|----------------|
| Rules and decisions | `.agents/kyro/scopes/rules.md`, future decisions files | Persistent | Read before relevant task |
| Roadmap/sprints/findings | Markdown | Persistent, human-auditable | Open only when evidence or mutation is required |
| Routing state | `state.json`, `index.json` | Derived persistent cache | Read first |
| Summaries | `*.summary.json`, `DEBT.summary.json` | Derived cache | Read before full Markdown |
| Current diff/test output | `events.ndjson` or task evidence | Temporary/session | Append compact evidence during execution; include in future active context pack |
| Metrics | Event log + reports | Persistent aggregate | Query/report |

## Markdown and Documentation Strategy

Markdown should remain the durable, human-readable evidence layer. The issue is not Markdown itself; it is missing contracts around ownership, derivation, validation, and staleness.

| Document | Recommended role | Manual or derived | Validator |
|----------|------------------|-------------------|-----------|
| `README.md` | Product overview and install path | Manual | links, command examples, version claims |
| `docs/architecture.md` | Architecture map | Mixed | docs index + source references |
| `docs/cli.md` | CLI behavior | Derived/mixed from source/help | command inventory check |
| `docs/commands-reference.md` | Command docs | Derived from `commands/*.md` | command-doc sync check |
| `docs/context-management.md` | Operating guidance | Manual | token budget references |
| `ROADMAP.md` | Planning source of truth | Manual/agent-authored | roadmap summary schema |
| `SPRINT-*.md` | Execution evidence | Manual/agent-authored | sprint summary schema |
| `AGENTS.md` | Host-agent instructions | Manual + managed block | managed block presence/size |

## Agent Harness, Hooks, and Commands

The harness should prefer deterministic hooks where possible. LLMs should not spend tokens rediscovering state or validating JSON shape.

| Hook/command | Trigger | Inputs | Outputs | Priority |
|--------------|---------|--------|---------|----------|
| `check:dist` | CI/pre-commit | `src/`, generated `dist/` | fail on stale generated output | DONE |
| `check:adapters` in CI | CI after build | built `dist/` | adapter fixture pass/fail | DONE |
| `artifact-validate` | after artifact write | artifact files | schema results | P1 |
| `context-pack` | before task | state/index/summaries/task id | minimal context bundle | P1 |
| `summary-refresh` | after Markdown mutation | Markdown artifacts | refreshed JSON summaries | P1 |
| `doc-impact-check` | after code/doc change | changed files, docs index | docs to update | P1 |
| `event-log-append` | phase/check transition | phase/check/result | append-only JSONL event | PARTIAL: schema/validation exists; writer pending |

## Vector Database and Retrieval Assessment

A vector database is not justified yet. The current corpus is small, structured, local, and mostly path/heading/frontmatter-addressable. The next step should be a local index and possibly SQLite FTS before any vector retrieval.

Vector retrieval becomes worth testing only if Kyro needs semantic recall across many repositories, historical sprints, issues, pull requests, and decisions where exact search is insufficient.

## Reliability and Validation System

| Stage | Required validation |
|-------|---------------------|
| Before task | scope exists, state/index valid, context pack generated, relevant rules loaded, git status reviewed |
| During task | changed files stay within task boundary, summaries refreshed after phase, no uncontrolled scope expansion |
| After task | targeted tests/checks, artifact validation, summary freshness, task evidence written |
| Before commit | dist freshness, adapter fixtures, no secrets/debug artifacts, docs impact reviewed |
| Before PR | full check, build, artifact fixtures, pack dry-run, audit report updated if behavior changed |
| After merge | regenerate docs/indexes, refresh summaries, update release notes if public behavior changed |

## Recommended Architecture

```text
Deterministic CLI core
  -> install/sync/uninstall/detect/doctor/repair/scope
  -> dist freshness checker
  -> token runtime path audit
  -> artifact doctor
  -> context-pack (pending)
  -> exported artifact schemas (pending)
  -> summary refresh (pending)
  -> doc impact analyzer (pending)
  -> event writer / metrics (pending)

Agent layer
  -> thin command stubs
  -> summary-first routers
  -> LLM analysis/implementation/review
  -> Markdown evidence updates

Artifact layer
  -> Markdown durable truth
  -> JSON derived routing/cache
  -> indexes derived/disposable
  -> event log append-only observability
```

## Official Documentation Platform

The official public documentation should be created at the end of the core harness stabilization work, not at the beginning. The recommended path is to evaluate Mintlify, GitBook, Docusaurus/Nextra, or an equivalent platform after reproducibility, artifact schemas, context-pack behavior, adapter docs, and validation contracts stabilize.

Default recommendation for evaluation: Mintlify for a developer-tooling docs-as-code workflow. GitBook remains a strong alternative if non-engineer collaboration is more important than repository-controlled documentation.

This work is tracked in `backlogs/09-official-documentation-platform.md`.

## Immediate Next Actions

1. Export JSON Schemas for artifact summaries and compact artifacts.
2. Add template/schema fixture validation beyond the current artifact fixtures.
3. Implement `kyro context-pack`.
4. Add documentation ownership metadata and validator.
5. Implement `kyro refresh-summaries` separate from repair.
6. Add event writer / metrics reports for token, context, validation, and retry outcomes.
7. After the remaining technical contracts stabilize, publish official documentation using Mintlify, GitBook, or an equivalent docs platform.
