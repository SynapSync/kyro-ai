---
title: 'organic-work — Sprint 2: Task Execution and Review'
date: '2026-09-26'
scope: 'organic-work'
sprint: 2
slug: 'task-execution-and-review'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 2: Task Execution and Review

> Closed: 2026-09-26
> Outcome: shipped

## Objective

Deliver CLI-owned Work task planning, dependency-safe execution, evidence recording, and criterion-complete review while preserving the independent Forge state.

## Definition of Done

- Every Sprint 2 task has real CLI-recorded evidence and a passing task review against its stated criteria.
- S12, S13, S17, S18, and S19 are demonstrated by executable Work CLI scenarios, including negative transitions and current digest checks.
- The Work task lifecycle preserves exact work.json v1 semantics, expected revisions, atomic writes, honest validation results, and byte-identical Forge state.
- The checkout build and targeted Work and Forge regressions have recorded outcomes; an installed-runtime capability mismatch is reported separately if still present.
- Sprint 3 task disposition and amendment invalidation and Sprint 4 promotion checks remain explicit future gates; this sprint does not claim closure or Forge QA certification.

## Phases

### P1 — Validated task graph

> Turn an explicit Work plan proposal into a valid, durable task graph and deterministic handoff.

#### T2.1: Plan Work tasks through the CLI

**Status**: done

**Description**: Implement kyro work plan using a structured proposal and expected revision. Validate exact task definitions, ordered Wn identifiers, nonempty unique criteria, safe file references, existing dependencies, and an acyclic graph before one atomic update. Activate a draft Work, append tasks_planned activity, and derive the handoff from the committed graph.

**Evidence**:
- Summary: Implemented CLI-owned Work task planning with exact proposal validation, normalized unique criteria, ordered W1..Wn identifiers, safe paths, dependency checks, cycle rejection, read-only preview, expected-revision conflict checks, atomic persistence, and deterministic handoff.
- Validation: npm run build — passed.
- Validation: npm run check:work-contract — passed.
- Validation: npm run check:work-plan — passed, including valid independent branches, preview preservation, invalid proposal rejection with unchanged bytes, and stale revision preservation.
- Validation: npm run check:work-store — passed.
- Validation: npm run check:work-isolation — passed.
- Validation: kyro doctor --artifacts --kyro-scope organic-work --json — passed all artifact checks.
- Files changed: `src/cli/commands/work.ts`, `src/cli/work/schema.ts`, `src/cli/work/store.ts`, `src/cli/types.ts`, `scripts/check-work-plan.mjs`, `package.json`

**Verdict**: pass

---
### P2 — Dependency-safe execution

> Expose eligible tasks and govern start, block, and unblock transitions without bypassing prerequisites.

#### T2.2: Implement task eligibility and execution transitions

**Status**: done

**Description**: Add CLI-owned start, block, and unblock transitions with expected revision and task activity. Derive eligible tasks and deterministic nextAction from task order, dependencies, blocked states, and review priority. Expose current task criteria, prerequisites, blockers, and executable CLI recipes in Work status and context-pack.

**Evidence**:
- Summary: Implemented Work start, block, and unblock transitions with CLI-stamped activity, revision preconditions, prerequisite eligibility checks, deterministic handoff, and task-aware status/context-pack views.
- Validation: npm run build — passed.
- Validation: npm run check:work-execution — passed; blocked W1 left independent W2 runnable, dependent W3 start failed without changing bytes, unblock restored W1 to pending, and stale revisions were rejected.
- Validation: npm run check:work-plan — passed.
- Validation: npm run check:work-contract — passed.
- Validation: npm run check:work-store — passed.
- Validation: npm run check:work-isolation — passed.
- Validation: kyro doctor --artifacts --kyro-scope organic-work --json — passed during T2.1 preflight; no Forge lifecycle source changed.
- Files changed: `src/cli/commands/work.ts`, `src/cli/work/schema.ts`, `scripts/check-work-execution.mjs`, `package.json`

**Verdict**: pass

---
### P3 — Evidence and review

> Bind real task evidence and independent review results to the current criteria and material digest.

#### T2.3: Record current task evidence

**Status**: done

**Description**: Implement kyro work record-evidence for an eligible in-progress task. Accept a bounded structured evidence proposal, retain the actual validation outcome and notes, calculate the material digest from the current brief and task definition, append evidence_recorded activity, and route the task to awaiting_review.

**Evidence**:
- Summary: Implemented bounded CLI-owned task evidence proposals. The command enforces exact input shape and truthful validation outcomes, computes material digests from the current brief and task definition, records CLI actor/time and evidence activity, and transitions only an eligible in-progress task to awaiting_review.
- Validation: npm run build — passed.
- Validation: npm run check:work-evidence — passed for pending-task rejection, read-only preview, exact evidence fields, digest binding, not_run visibility, invalid path preservation, and stale-revision preservation.
- Validation: npm run check:work-execution — passed.
- Validation: npm run check:work-plan — passed.
- Validation: npm run check:work-contract — passed.
- Validation: npm run check:work-store — passed.
- Validation: npm run check:work-isolation — passed.
- Validation: kyro doctor --artifacts --kyro-scope organic-work --json — passed.
- Files changed: `src/cli/commands/work.ts`, `src/cli/work/schema.ts`, `scripts/check-work-evidence.mjs`, `package.json`

**Verdict**: pass

---
#### T2.4: Review evidence against every current criterion

**Status**: done

**Description**: Implement kyro work review for awaiting_review tasks. Verify exact criterion coverage, current definition revision, evidence digest, reviewed material digest, validation outcomes, and findings before a pass can mark a task verified. Record a fail verdict and return the task to in_progress when review fails.

**Evidence**:
- Summary: Implemented CLI-owned Work task review with exact current-criterion coverage, fresh material/evidence digest checks, validation-result and critical-finding pass vetoes, tool-stamped verdicts, and fail-to-in_progress retry behavior requiring fresh evidence.
- Validation: npm run build — passed.
- Validation: npm run check:work-review — passed for incomplete/extra criteria, critical and not_run vetoes, failure routing, fresh evidence, digest binding, and dependent release.
- Validation: npm run check:work-evidence — passed.
- Validation: npm run check:work-execution — passed.
- Validation: npm run check:work-plan — passed.
- Validation: npm run check:work-contract — passed.
- Validation: npm run check:work-store — passed.
- Validation: npm run check:work-isolation — passed.
- Validation: kyro doctor --artifacts --kyro-scope organic-work --json — passed.
- Files changed: `src/cli/commands/work.ts`, `src/cli/work/schema.ts`, `scripts/check-work-review.mjs`, `package.json`

**Verdict**: pass

---
### P4 — End-to-end verification

> Prove the complete task lifecycle, isolated state, and honest failure handling before handing off later Work features.

#### T2.5: Verify the Work task lifecycle and document its CLI flow

**Status**: done

**Description**: Run a real CLI sequence from create through plan, start, evidence, fail or pass review, and dependency release using disposable test workspaces. Add targeted regression checks and concise English CLI guidance for implementers and reviewers. Record actual commands and outcomes in Kyro task evidence during execution.

**Evidence**:
- Summary: Completed the disposable Work lifecycle regression, Forge-state byte snapshots, English CLI guidance, and task lifecycle help. The workspace build exposes Work; the installed global Kyro 5.0.1 still does not, and no global install/update was performed.
- Validation: npm run build — passed; dist/ freshness was also confirmed by npm run check:dist during the aggregate check.
- Validation: node dist/cli.js work --help — passed; all implemented task lifecycle commands are listed.
- Validation: npm run check:work-lifecycle — passed; plan/start/block/unblock/evidence/fail/pass/recovery/dependency-release flow and project.json/local.json/pre-existing sprint.json byte snapshots were verified in a disposable workspace.
- Validation: npm run check:work-review — passed.
- Validation: npm run check:work-evidence — passed.
- Validation: npm run check:work-execution — passed.
- Validation: npm run check:work-plan — passed.
- Validation: npm run check:work-contract — passed.
- Validation: npm run check:work-store — passed.
- Validation: npm run check:work-isolation — passed.
- Validation: npm run check:git-trackability — passed.
- Validation: npm run check:links — passed; all relative links valid across 89 files.
- Validation: Forge regressions: check:record-evidence, check:maker-checker, check:status, check:plan, check:lifecycle-replay, check:operation-snapshots, and check:capabilities all passed.
- Validation: npm run check — failed at check:repair-integrity because installed global Kyro 5.0.1 lacks the work capability; later checks were run separately where relevant and passed. No global update was performed.
- Files changed: `scripts/check-work-lifecycle.mjs`, `package.json`, `src/cli/help.ts`, `docs/work.md`

**Verdict**: pass

---

## Unfinished work

_None — every task is done with a passing verdict._

## Learnings

- Action-specific context packs and dependency handoffs need adversarial lifecycle tests, not only schema validation.
- Evidence provenance and reviewer identity are workflow claims, not authenticated execution or independent QA.
- Large Work graphs require bounded input, iterative cycle detection, indexed lookup, and complete JSON output.

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 3

- Implement CLI-owned brief and task amendments with revision invalidation and preserved history.
- Implement Work closure with explicit dispositions and truthful partial outcomes.
- Expose Work through the supported public command and installation surfaces without changing Forge behavior.
