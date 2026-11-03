---
title: 'sprint-git-traceability — Sprint 4: Remediation chain verification across later sprint closes'
date: '2026-11-03'
scope: 'sprint-git-traceability'
sprint: 4
slug: 'remediation-lifecycle'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 4: Remediation chain verification across later sprint closes

> Closed: 2026-11-03
> Outcome: shipped

## Objective

kyro doctor --artifacts and kyro repair integrity accept authorized sprint closes recorded after a remediation chain head, while still detecting real divergence, so PR #154 CI passes and the close validation runs the artifact doctor.

## Definition of Done

- All tasks done with CLI-recorded evidence and a passing verdict.
- Proportional close validation, including npm run check:artifacts, passes; escalation applies (src/cli/repair/**, remediation).
- debt-8 resolved through T4.2.

## Phases

### P1 — Lifecycle-aware remediation verification

> Fix the false DIVERGED and unblock chain extension.

#### T4.1: Verify remediation chains against their bound checkpoint and accept later authorized closes

**Status**: done

**Description**: doctor --artifacts reports the chain head R-001 of scope sprint-git-traceability as DIVERGED because the remediation lens (src/cli/remediation/plan.ts inspectRemediationTransaction ~421-428) and the verification walk (deriveScopeVerificationState ~943-957) compare the head's result.stateSha256 directly with live state; isSupersededByActiveSprint (~442-451) only excuses an active later sprint, and the digest-directed path resolveScopeEvolution (~659+) is skipped because usesBoundEvolution (~652-656) requires completion data or schemaVersion >= 5. repair integrity prepare is blocked too: resolveRemediationReplayState (~776-831) replays from the newest checkpoint instead of the record's base. Make verification and replay lifecycle-aware: verify each record against the checkpoint image it is bound to (base.checkpoints), then accept later authorized sprint closes whose checkpoints chain from that state; real divergence (any change not explained by the chain plus later authorized closes) must still fail.

**Evidence**:
- Summary: Close-validation fix by Sol 6.1: scripts/check-cli-bundle-assets.mjs no longer asserts a hardcoded '315 assertions passed'; it runs the same check-verification-states harness against the source checkout and the projected runtime, requires successful exits and valid summaries, and compares their assertion counts. Remediation logic (checkpoint-bound replay, debt content preservation) unchanged since Astra's approval.
- Validation: npm run check:cli-bundle-assets: pass, source and projected counts both 523; npm run check:verification-states: 523 assertions passed; npm run check:cli-bundle: pass; npm run build: pass (reported by Sol 6.1)
- Validation: grep of scripts/ found no other hardcoded counts for check:verification-states or check:scope-remediation (unrelated check:debt-contract count unchanged) (reported by Sol 6.1)
- Files changed: `src/cli/remediation/plan.ts`, `src/cli/repair/integrity-plan.ts`, `scripts/check-verification-states.mjs`, `scripts/check-scope-remediation.mjs`, `scripts/check-cli-bundle-assets.mjs`, `docs/sprint-close-checkpoints.md`

**Verdict**: pass

---
#### T4.2: Run the artifact doctor in close validation and confirm PR #154 CI

**Status**: done

**Description**: Add npm run check:artifacts to the close commands of .agents/kyro/validation.json so every sprint close runs the artifact doctor that CI runs, then confirm on PR #154 that validate and the Windows jobs pass after the Sprint 4 push (resolves debt-8).

**Evidence**:
- Summary: Added npm run check:artifacts to the close commands of .agents/kyro/validation.json (close: npm run build, npm run check:artifacts) so sprint close runs the artifact doctor CI runs. PR #154 CI on the Sprint 4 push (a7f0ab3) is green: validate (which includes check:artifacts, the previously failing step) and Windows Node 18/20/22.
- Validation: Read .agents/kyro/validation.json: close = [npm run build, npm run check:artifacts]; kyro analyze: no validation-tier issue
- Validation: Local close validation on the final tree: npm run build, npm run check (88 scripts, exit 0), npm run check:artifacts (exit 0, no [FAIL])
- Validation: gh run view 41579603446 at a7f0ab365c443dd99d456e38aa85d48328a02ce4: validate success https://github.com/SynapSync/kyro-ai/actions/runs/41579603446/job/125731080101; Windows Node 18.x success .../job/125731080535; Node 20.x success .../job/125731080447; Node 22.x success .../job/125731080402
- Files changed: `.agents/kyro/validation.json`
- Notes: Also provides the Windows evidence for Sprint 3 changes (debt-8).

**Verdict**: pass

---

## Unfinished work

_None — every task is done with a passing verdict._

## Learnings

- Close validation must run every command CI runs; npm run check alone missed check:artifacts.
- Kyro state writes from the orchestrator can collide with an implementer's Kyro commands on the same workspace lock; write state only when agents are idle.
- Tests that assert hardcoded assertion counts break when regressions are added; compare against a reference run instead.

## Resolved Debt

- **debt-1**: plan --update-active leaves phase statuses incoherent (active/blocked with all-pending tasks)
- **debt-2**: Root-level .kyro-state-writer.lock/ is not gitignored
- **debt-3**: Forward compatibility: checkpoints with close.git fail verification on runtimes older than this release
- **debt-4**: Structured git range and warnings in CLI --json close data and MCP results, with an MCP assertion
- **debt-5**: Resumed close without frozen close.git reports a present-time reason
- **debt-6**: plan sprint-mode --json envelope lacks data.outcome
- **debt-7**: Confirm Windows CI runs check:sprint-close-commit and check:sprint-git-traceability green before release
- **debt-8**: Confirm Windows CI for the Sprint 3 changes (active-plan statuses, root lock exclude) after push

## Recommendations for Sprint 5

- Decide on scope completion; no open debt remains.
- Release 6.5.0 is a user decision; afterwards update kyro-qa-assist to v1.1 in skills-registry to use ledger[].git ranges.
