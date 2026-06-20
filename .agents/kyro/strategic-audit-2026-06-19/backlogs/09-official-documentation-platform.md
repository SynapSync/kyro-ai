# Backlog: Official Documentation Platform

Kyro needs official public documentation once the technical contracts stabilize. This should be a productization phase, not an early task. If docs are published before the CLI, artifact schemas, adapters, and context model settle, the team will spend energy documenting churn instead of documenting a stable product.

## Decision

Use a documentation platform such as Mintlify, GitBook, or an equivalent modern docs system after P0/P1 harness reliability work is complete.

Preferred default for evaluation: Mintlify, because it is strong for developer-facing products, docs-as-code, MDX-style content, navigation control, and polished API/CLI documentation. GitBook remains a good alternative if team collaboration and non-engineer editing are more important than docs-as-code control.

## Trigger to start

Start this backlog only when these are true:

- P0 reproducibility/CI work is complete. **Done as of 2026-06-20.**
- Artifact schemas and validation contracts are documented.
- Context-pack, summary refresh, and docs-index direction is stable.
- Adapter support matrix is current and validated.
- Public command names and install flow are not expected to churn immediately.

## Tasks

| ID | Priority | Size | Task | Likely files | Acceptance criteria | Validation |
|----|----------|------|------|--------------|---------------------|------------|
| DOCS-001 | P2 | S | Evaluate docs platform options | `docs/official-docs-platform-decision.md` | Decision compares Mintlify, GitBook, Docusaurus/Nextra, and hosted/static tradeoffs | Decision doc reviewed |
| DOCS-002 | P2 | M | Define official docs information architecture | docs platform config, `docs/` | Navigation covers getting started, install, adapters, commands, artifact model, context strategy, troubleshooting, release process | IA review checklist |
| DOCS-003 | P2 | M | Create docs platform scaffold | `mint.json` or platform equivalent, docs content folders | Local docs preview runs; navigation renders core pages | Platform local preview command |
| DOCS-004 | P2 | M | Migrate stable docs into official structure | `README.md`, `docs/*.md`, platform pages | Public docs avoid internal audit noise and present stable user journeys | Link/navigation check |
| DOCS-005 | P2 | M | Add docs validation to CI | `.github/workflows/ci.yml`, docs scripts | CI validates links, platform config, and broken references | CI docs check |
| DOCS-006 | P2 | M | Add release docs workflow | docs config, release docs | New Kyro releases have docs update checklist and versioned notes where appropriate | Release checklist includes docs gate |
| DOCS-007 | P3 | M | Add hosted docs deployment | hosting/platform config | Docs deploy from main or release branch with preview support for PRs | Preview/deploy evidence |

## Platform evaluation criteria

| Criterion | Why it matters |
|-----------|----------------|
| Docs as code | Kyro is developer tooling; docs should version with code |
| CLI reference quality | Commands and flags must be easy to scan |
| Navigation control | Users need a clear path from install to forge/status/wrap-up |
| Search quality | Docs must answer adapter/artifact troubleshooting quickly |
| Versioning support | Releases may change adapter behavior and artifact contracts |
| CI integration | Docs should fail fast on broken links/config |
| Low maintenance | The docs platform should not become a product by itself |

## Recommended documentation structure

```text
docs-site/
  getting-started/
    quickstart
    installation
    first-forge
  concepts/
    architecture
    artifact-model
    context-management
    adapters
  reference/
    cli
    commands
    configuration
    artifact-schemas
  guides/
    codex
    opencode
    claude-plugin
    troubleshooting
  releases/
    latest
    changelog
```

## Content migration policy

| Source | Destination | Notes |
|--------|-------------|-------|
| `README.md` | Landing + quickstart | Keep README short; docs site gets depth |
| `docs/cli.md` | CLI reference | Should be generated or checked against CLI help eventually |
| `docs/agent-adapters.md` | Adapter concept/reference | Keep support matrix validated |
| `docs/context-management.md` | Concept + guide | Include context-pack once implemented |
| `docs/architecture.md` | Architecture concept | Avoid exposing internal audit backlog as user docs |
| Release notes | Releases section | Stable, public-facing release framing |

## Out of scope

- Do not publish the strategic audit backlog as public docs.
- Do not document experimental vector retrieval as a committed product capability.
- Do not choose a platform before evaluating docs-as-code, search, versioning, and CI tradeoffs.
