# Kyro AI Strategic Optimization Technical Audit

Kyro AI is already moving in the right direction: a portable workflow harness with command routers, adapter projections, Markdown evidence, JSON routing state, and deterministic CLI checks. The next evolution should make that harness more reproducible, measurable, and cheaper for agents to operate.

## Executive Summary

Kyro does not need a vector database, knowledge graph, or extra autonomous agents by default. Its highest-return path is to move more repeatable behavior into the CLI and leave analysis, judgment, and implementation to the agent.

The most serious verified issue is reproducibility drift: the committed `dist/` output does not match `src/`. Source supports newer CLI behavior such as `detect`, `--adapters`, preflight, drift, injectors, and pipeline modules, while committed `dist/` is stale or missing generated files. `npm run check:adapters` fails on the current checkout before rebuild, but passes after `npm run build` in a temporary copy.

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
| CLI | install, sync, uninstall, doctor, repair, scope, detect | None | Add context packs, schema validation, dist freshness, doc impact, event log |
| Adapters | project command stubs, managed blocks, settings overlays | Host agent interpretation | Keep stubs thin; validate generated projections |
| Commands | route to modes | Agent follows router | Keep commands as route selectors only |
| Skills | workflow rules, templates, helpers | Agent reads and applies instructions | Deduplicate repeated prose and make rules checkable |
| Artifacts | JSON summaries and state validation | Markdown creation and updates | Markdown remains evidence; JSON remains routing cache |

## Key Problems Identified

| Priority | Problem | Evidence | Impact |
|----------|---------|----------|--------|
| P0 | Stale `dist/` relative to `src/` | `node dist/cli.js doctor --adapters` fails; source parser supports `--adapters` | Published/runtime behavior can differ from source |
| P0 | Adapter fixture checks are not in CI | `.github/workflows/ci.yml` runs core checks but not `check:adapters` | Adapter regressions can escape |
| P1 | Artifact schemas are TypeScript-only | `src/cli/artifacts/schema.ts` validates runtime shape, but no exported JSON Schema contract | Agents/templates cannot validate output generically |
| P1 | Context packs are implicit, not generated | Routers describe read order, but CLI cannot emit a minimal task context package | Agents repeat exploration and overshare context |
| P1 | Documentation ownership is not formalized | Docs and artifacts lack consistent `source_of_truth`, `derived_from`, and validator metadata | Markdown drift is hard to detect |
| P1 | Summary refresh is coupled to repair | `repair` reconstructs summaries, but no first-class happy-path refresh command exists | Agents may leave stale JSON caches |
| P2 | Observability is mostly final-state based | State and summaries exist, but no append-only event timeline exists | Debugging agent failures requires reconstructing history |
| P2 | Model routing is guidance, not contract | Docs mention cheaper/stronger models, but no manifest maps task type to budget/model tier | Cost control relies on discipline |

## Token and Cost Optimization Opportunities

Kyro already has a strong progressive-disclosure base: small command routers, mode-gated assets, structured summaries, and `doctor --tokens`. The next technical step is to make context selection a CLI output rather than a prompt convention.

| Opportunity | Technical correction | Expected effect | Priority |
|-------------|----------------------|-----------------|----------|
| Generate context packs | `kyro context-pack --kyro-scope <scope> --task <id>` | Less repeated file loading | P1 |
| Deduplicate route/gate prose | Make one source canonical and derive repeated docs where possible | Lower startup tokens and less drift | P1 |
| Track route token estimates | Add token estimate output per route/context pack | Measurable cost baseline | P1 |
| Tool/result cache metadata | Store summary hashes and source mtimes | Avoid unnecessary Markdown reads | P2 |
| Model routing manifest | Map task type to context budget and model tier | Lower cost for status/classification tasks | P2 |

## Context and Memory Architecture

| Context type | Storage | Lifetime | Retrieval mode |
|--------------|---------|----------|----------------|
| Rules and decisions | `.agents/kyro/scopes/rules.md`, future decisions files | Persistent | Read before relevant task |
| Roadmap/sprints/findings | Markdown | Persistent, human-auditable | Open only when evidence or mutation is required |
| Routing state | `state.json`, `index.json` | Derived persistent cache | Read first |
| Summaries | `*.summary.json`, `DEBT.summary.json` | Derived cache | Read before full Markdown |
| Current diff/test output | Event log or task evidence | Temporary/session | Include in active context pack |
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
| `check:dist` | CI/pre-commit | `src/`, generated `dist/` | fail on stale generated output | P0 |
| `check:adapters` in CI | CI after build | built `dist/` | adapter fixture pass/fail | P0 |
| `artifact-validate` | after artifact write | artifact files | schema results | P1 |
| `context-pack` | before task | state/index/summaries/task id | minimal context bundle | P1 |
| `summary-refresh` | after Markdown mutation | Markdown artifacts | refreshed JSON summaries | P1 |
| `doc-impact-check` | after code/doc change | changed files, docs index | docs to update | P1 |
| `event-log-append` | phase/check transition | phase/check/result | append-only JSONL event | P2 |

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
  -> context-pack
  -> artifact schema validator
  -> summary refresh
  -> doc impact analyzer
  -> dist freshness checker
  -> event logger

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

1. Rebuild and commit fresh `dist/`.
2. Add `check:dist` to fail when generated output is stale.
3. Add `npm run check:adapters` to CI after build.
4. Export JSON Schemas for artifact summaries.
5. Add template/schema fixture validation.
6. Implement `kyro context-pack`.
7. Add documentation ownership metadata and validator.
8. Implement `kyro refresh-summaries` separate from repair.
9. Add event log append-only infrastructure.
10. Add metrics reports for token/context and validation outcomes.
11. After the technical contracts stabilize, publish official documentation using Mintlify, GitBook, or an equivalent docs platform.
