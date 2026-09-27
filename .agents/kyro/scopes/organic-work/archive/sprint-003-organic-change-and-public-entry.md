---
title: 'organic-work — Sprint 3: Organic Change, Closure, and Public Entry'
date: '2026-09-27'
scope: 'organic-work'
sprint: 3
slug: 'organic-change-and-public-entry'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 3: Organic Change, Closure, and Public Entry

> Closed: 2026-09-27
> Outcome: shipped

## Objective

Deliver CLI-owned Work amendments, explicit task disposition and closure, and supported public entry points while preserving Work history and Forge isolation.

## Definition of Done

- Every Sprint 3 task has current CLI-recorded evidence and a passing criterion-complete checker verdict.
- Work amendments, disposition, close/reopen, and public entry pass adversarial lifecycle and Forge-isolation regression checks.
- The workspace build and aggregate check suite pass, package and adapter artifacts are verified, and artifact doctor/analyze show no critical or high findings.
- Independent Kyro QA is offered before sprint close; any blocking finding is remediated and re-reviewed before closure.

## Phases

### P1 — Controlled amendments

> Change Work definitions through validated CLI operations without retaining stale approvals.

#### T3.1: Amend task definitions through the CLI

**Status**: done

**Description**: Implement previewable, revision-guarded task amendments for title, description, context, files, criteria, and dependencies. Preserve task identity and order, validate the entire resulting graph, advance definitionRevision only for a material definition change, and invalidate affected current evidence and verdicts without rewriting prior activity.

**Evidence**:
- Summary: Implemented CLI-owned amend-task: exact proposal shape with required reason/actor/revision, read-only preview, atomic apply, material-change definitionRevision bump, stale approval invalidation with downstream cascade, full graph and handoff validation.
- Validation: npm run build: pass, dist rebuilt with amend-task and amend-brief verbs
- Validation: npm run typecheck: pass
- Validation: npm run check:work-amend: pass (preview/read-only, apply, no-op rejection, 8 malformed cases, reason/actor gates, stale revision, pass invalidation with W1->W2 cascade, prerequisite removal)
- Validation: Existing Work checks pass: contract, plan, execution, evidence, review, lifecycle, store, isolation
- Validation: npm run check:cli-envelope and check:cli-verbs: pass
- Files changed: `src/cli/commands/work.ts`, `src/cli/work/schema.ts`, `scripts/check-work-amend.mjs`, `package.json`
- Notes: Unchanged input is rejected without a new revision or approval. Disposed-task amendment is guarded in code; CLI-level disposed coverage awaits the T3.3 dispose verb. types.ts needed no change: v1 types already cover task_amended events.

**Verdict**: pass

---
#### T3.2: Amend the brief with digest-bound invalidation

**Status**: done

**Description**: Implement a previewable, revision-guarded amend-brief operation that copies new brief bytes through the CLI, updates the brief digest, and invalidates every current approval unless the CLI can prove a narrower impact. Preserve a reasoned amendment event and fail closed on out-of-band brief changes.

**Evidence**:
- Summary: Closed the amendment-source TOCTOU and unbounded-read gap while retaining durable brief recovery and exact-byte publication.
- Validation: npm run build: passed
- Validation: npm run check:work-amend: passed, including deterministic post-fstat growth and symlink rejection
- Validation: npm run check:work-isolation: passed
- Validation: npm run check:dist: passed
- Validation: npm run check: passed, full aggregate after source hardening
- Validation: kyro doctor --artifacts --kyro-scope organic-work --json: passed
- Validation: npm pack --dry-run --json: passed
- Validation: git diff --check: passed
- Files changed: `src/cli/commands/work.ts`, `src/cli/work/store.ts`, `scripts/check-work-amend.mjs`, `docs/work.md`, `.agents/kyro/.gitignore`
- Notes: Source opens once O_RDONLY|O_NOFOLLOW; unsupported platforms fail closed. fstat and bounded limit-plus-one read use the same descriptor, closed reliably. The prior fail finding remains preserved in history; P2 and independent QA were not started. Analyze retains one non-blocking future S16 MEDIUM note.

**Verdict**: pass

---
### P2 — Disposition and truthful closure

> Make abandoned and completed Work outcomes explicit, reversible where allowed, and distinguishable from verified work.

#### T3.3: Dispose of tasks without implying verification

**Status**: done

**Description**: Implement explicit cancelled and superseded dispositions with reason, actor, timestamp, and replacement reference where required. Preserve dependencies as written so cancelled or superseded prerequisites do not silently unblock dependents.

**Evidence**:
- Summary: Implemented explicit CLI-owned task disposition with actor, reason, timestamp, replacement validation, preserved failed review and dependency edges, deterministic handoff, and activity history.
- Validation: npm run build: passed
- Validation: npm run check:work-disposition: passed
- Validation: npm run check:work-contract: passed
- Validation: npm run check:work-lifecycle: passed
- Validation: npm run check:work-amend: passed
- Validation: npm run check:work-isolation: passed
- Validation: kyro doctor --artifacts --kyro-scope organic-work: passed
- Files changed: `src/cli/commands/work.ts`, `src/cli/work/schema.ts`, `scripts/check-work-disposition.mjs`, `docs/work.md`, `package.json`

**Verdict**: pass

---
#### T3.4: Close and reopen Work with honest outcomes

**Status**: done

**Description**: Implement preview-and-confirm Work close for completed or stopped outcomes, plus explicit reasoned reopen for closed Work. Derive verified, disposed, pending, blocked, and review-waiting counts from tasks; preserve closure history and reject reopening promoted Work.

**Evidence**:
- Summary: Implemented confirmed Work close/reopen with truthful task summaries, versioned closure provenance, durable retry, Forge isolation, and correct applied/preview/result machine-envelope phases after a failed integration review.
- Validation: npm run build: passed
- Validation: npm run check:cli-envelope: passed
- Validation: npm run check:work-closure: passed
- Validation: npm run check:work-disposition: passed
- Validation: npm run check:dist: passed
- Validation: npm run check: passed on final source snapshot
- Validation: kyro doctor --artifacts --kyro-scope organic-work: passed
- Validation: kyro analyze --kyro-scope organic-work: zero CRITICAL/HIGH, one MEDIUM future S16 finding
- Validation: npm pack --dry-run --json: passed
- Validation: git diff --check: passed
- Files changed: `src/cli/commands/work.ts`, `src/cli/work/schema.ts`, `src/cli/work/store.ts`, `src/cli/types.ts`, `src/cli/core/cli-envelope.ts`, `scripts/check-work-closure.mjs`, `scripts/check-cli-envelope.mjs`, `docs/work.md`, `package.json`

**Verdict**: pass

---
### P3 — Public entry and integration

> Expose the Work path explicitly in supported hosts and prove that the complete lifecycle remains isolated from Forge.

#### T3.5: Expose Work through supported command and skill surfaces

**Status**: done

**Description**: Add an explicit Kyro Work public entry point and project it through supported adapter/install surfaces without changing existing Forge routing. The entry point must teach agents to request fresh Work context and write work.json only through the CLI.

**Evidence**:
- Summary: Added explicit Work command routing and projected host skills for Claude, OpenCode, Codex, and standard agents without changing Forge selection. Work router requires capability handshake and fresh status/context-pack, and adapter fixtures cover install, sync, and uninstall.
- Validation: npm run build: passed
- Validation: npm run check:adapters: passed (known external global runtime work capability skew isolated)
- Validation: npm run check:claude-plugin-surface: passed
- Validation: npm run check:command-modes: passed
- Validation: npm run check:cli-bundle-assets: passed
- Validation: npm run check:no-placeholder: passed
- Validation: npm run check:links: passed
- Validation: npm run check:dist: passed
- Validation: git diff --check: passed
- Files changed: `commands/work.md`, `internal/skills/organic-work/SKILL.md`, `providers/claude/commands/work.md`, `src/cli/constants.ts`, `src/cli/adapters/command-skills.ts`, `src/cli/adapters/codex.ts`, `src/cli/adapters/opencode.ts`, `scripts/check-adapter-fixtures.mjs`, `docs/work.md`, `package.json`

**Verdict**: pass

---
#### T3.6: Verify the complete Sprint 3 lifecycle and documentation

**Status**: done

**Description**: Update English Work documentation and run end-to-end disposable-workspace regression for amendment, disposition, close/reopen, public entry, packaging, and Forge byte isolation. Capture observed outcomes, limitations, and supported runtime boundaries before task review.

**Evidence**:
- Summary: Final-snapshot lifecycle and public-entry integration is complete: every successful disposable Work mutation validates persisted schema and status/handoff; task/brief amendments, stale review, disposal, both closure outcomes, reopen, and Forge byte isolation are covered. Help and host documentation match the supported CLI.
- Validation: npm run build: passed
- Validation: npm run check: passed on final snapshot
- Validation: npm run check:adapters: passed
- Validation: npm run check:work-lifecycle: passed
- Validation: npm run check:work-amend: passed
- Validation: npm run check:work-disposition: passed
- Validation: npm run check:work-closure: passed
- Validation: npm run check:cli-envelope: passed
- Validation: npm run check:links: passed
- Validation: npm run check:dist: passed
- Validation: kyro doctor --artifacts --kyro-scope organic-work: passed
- Validation: kyro analyze --kyro-scope organic-work: exit 0; one MEDIUM future S16 coverage note, no HIGH or CRITICAL
- Validation: npm pack --dry-run --json: passed; Work assets included
- Validation: git diff --check: passed
- Files changed: `scripts/check-work-lifecycle.mjs`, `scripts/check-adapter-fixtures.mjs`, `scripts/check-cli-envelope.mjs`, `docs/work.md`, `src/cli/help.ts`, `README.md`, `docs/commands-reference.md`, `docs/agent-adapters.md`, `docs/architecture.md`, `.claude-plugin/marketplace.json`, `.claude-plugin/README.md`, `AGENTS.md`

**Verdict**: pass

---

## Unfinished work

_None — every task is done with a passing verdict._

## Learnings

- Recoverable multi-file Work publication needs a durable intent record and exact-byte, bounded source ingestion; a matching file alone is not proof of CLI ownership.
- Machine envelopes must classify every Work mutation truthfully, including preview and read-only verbs; test public adapter projections separately from the Work writer.

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 4

- Plan Sprint 4 around explicit, previewed Work-to-Forge promotion with reciprocal links and S16 coverage.
- Resolve debt-1 and debt-2 before release; then bump the package version and verify an authorized install/sync and doctor handshake.
