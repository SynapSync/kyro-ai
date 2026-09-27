# Organic Work Sprint 2 Remediation Plan

## Purpose and boundary

Correct the implementation gaps found in the owner review before independent QA. These are emergent tasks in the still-open Sprint 2, not a new sprint. Preserve the exact Work v1 JSON shape, CLI-only writes, revision checks, atomic persistence, and Forge byte isolation. Do not close the sprint or claim QA certification from task reviews.

## E1: Actionable status and context pack

- Make `eligible` mean eligible to **start**, not merely executable work already in progress.
- Derive recipes from the selected task's actual status and current revision: start only for eligible pending; block only for pending or in-progress; unblock only for blocked; record evidence for in-progress; review for awaiting-review; and plan only for a draft.
- Include task description, context, and intended files in the read model so a fresh agent can resume without reading Forge state. When brief integrity fails, expose the anomaly but no mutation recipe.
- Add tests for every state, stale revision, explicit task selection, and the default handoff task.

## E2: Failed-review blocking coherence

- Define the legal transition when an in-progress task carries failed evidence and a failed verdict. Blocking must not silently discard the failure or yield an unreadable Work.
- Choose and document a coherent rule: either preserve the failed review through block/unblock with schema support, or reject blocking with a clear, explicit diagnostic. The preferred rule is to preserve the failure and return to in-progress after unblock, because the failed review requires remediation rather than a fresh start.
- Add an end-to-end regression covering fail, block, status/context-pack, unblock, fresh evidence, and pass. Assert Work/Forge bytes on rejected transitions.

## E3: Honest evidence and checker boundary

- Keep validation results as declared evidence; do not execute arbitrary proposal commands or imply that CLI parsing proves they ran.
- Require explicit, non-placeholder maker and checker identities for new evidence and review writes, reject a pass by the same actor, and expose the reviewer identity and evidence provenance in status/context-pack. A pass remains a checker attestation tied to exact current criteria and digests, never an automatic test or Forge QA certificate.
- Add negative tests for absent identities, same-actor pass, `failed`/`not_run`, stale material, and a review lacking criterion coverage. Update CLI help and English documentation to state the trust boundary plainly.
- Preserve readability of existing Work v1 artifacts; do not add keys to `work.json` or retroactively invalidate historical reviews solely because earlier writes used the `cli` actor.

## E4: Unbounded graph safety and integration

- Replace recursive cycle detection in both proposal and stored-document validation with an iterative algorithm. Avoid repeated linear dependency lookups in status/context-pack.
- Bound proposal input bytes according to an explicit resource-safety budget without a policy limit on conceptual task count or complexity; report the operational limit precisely.
- Add a long acyclic chain, a deep cycle, and a broad independent-task fixture. Verify deterministic handoff, no stack overflow, and no partial writes on rejection.
- Run focused Work checks, TypeScript build, package checks, Forge isolation, and artifact integrity. Record evidence and task reviews through Kyro CLI. Independent QA remains a separate gate.

## E5: Complete machine envelopes for large Work graphs

- A long-graph probe exposed a partial stdout write in the shared machine-envelope writer. A single synchronous write may return fewer bytes than requested when stdout is a pipe.
- Use Node's buffered stdout write and natural process drain rather than a single synchronous pipe write; avoid forced exit on the machine-success path. Keep the envelope schema and command phase behavior unchanged.
- Extend the disposable Work graph fixture to parse plan and status output for thousands of tasks and retain the existing CLI envelope regression suite.
