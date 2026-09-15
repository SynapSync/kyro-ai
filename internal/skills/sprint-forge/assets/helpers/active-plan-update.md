# Active Plan Update — Existing Tasks, Same Sprint

Load only when the definition of an existing active task needs to change. The agent edits a small input document; **only `plan --update-active` writes `sprint.json`**. Never edit managed state or archives directly.

## Authority

- Both parents must permit the change: an open scope AND its current unclosed sprint.
- `pending`, `in_progress`, `blocked`, and `done` tasks may have their active definitions updated. A passing review or `activeSprint.status: complete` alone does not mean the sprint is closed.
- A closed/shipped/archived sprint stays immutable even if the scope remains open or is later reopened. Stop and explain the historical boundary; never copy old tasks back into `activeSprint`.
- A prepared/interrupted close is recovery work, not permission to edit.
- A disposition is not silently removed: updating its description does not reactivate execution.

## Procedure

1. Read the scoped task pack. For this planning operation, read the relevant/full `sprint.json` to obtain the exact sprint number/slug, current definitions and consumers. Do not infer identity from a task ID or filename alone.
2. Explain the correction and its scope. Requirement changes need the applicable user approval; never weaken criteria to conceal a failure. Preserve scope objective, non-goals and project principles.
3. Write only a temporary input file, for example:

   ```json
   {
     "sprint": { "n": 3, "slug": "authorization-boundaries" },
     "reason": "Separate preparation authorization from destructive-operation authorization.",
     "tasks": [
       {
         "id": "T3.3",
         "context": "Preparation and destructive actions require separate approvals.",
         "acceptance_criteria": [
           "Preparation requires its own explicit authorization.",
           "Destructive actions require a later explicit authorization."
         ]
       }
     ]
   }
   ```

   Task fields: `title`, `description`, `context`, `acceptance_criteria`, `files_to_touch`, `depends_on`, `scenario_refs`. Arrays replace the complete field: preserve every still-valid criterion. No task additions/removals, status, evidence, verdict, debt, handoff or history fields.

   Optional `requirements: [{id, statement, priority?, rationale?}]` and `scenarios: [{id, requirement, given, when, then}]` update/add active definitions. Existing scenario requirement links cannot be changed. Historical/shared definitions with unverified historical consumers cannot be rewritten; retain the original and use a new active identity.
4. Preview: `{{KYRO_CLI}} plan --update-active --from <input.json> --kyro-scope <scope> --dry-run --json`.
5. Inspect the complete diff, deleted criteria, affected task IDs and invalidations. The CLI conservatively includes scenario/requirement consumers and transitive dependents in both the old and new graphs. Do not run a separate `review fail` between this preview and apply: the update owns invalidation atomically.
6. After the change is approved, apply the same input: `{{KYRO_CLI}} plan --update-active --from <input.json> --kyro-scope <scope> --digest <preview-digest> --yes --json`.
   - Stale digest → obtain a new preview and approval; never silently refresh and apply.
   - Unknown option/runtime → stop and upgrade through the normal startup remedy. No manual fallback.
   - A failed apply may have committed the entire atomic state before an I/O error. Inspect fresh state; never restore old evidence or repeat blindly. Re-preview; an already-matching input is a no-op. There is no durable request receipt.
7. Re-read the task pack. Affected verdicts have been cleared; previously done tasks return to pending. Unaffected tasks and closed history are preserved. Old evidence is retained as reference, **not proof of the changed work**.
8. Implement/check the affected tasks, then use `record-evidence` and fresh `review` normally. Validation failure keeps work unapproved; the normal correction limit and blocked flow still apply.

## Verification and QA

- Repeat checks appropriate to actual impact, not the entire product suite merely for every text edit.
- Existing task review remains required; no new optional certification is introduced.
- If prior QA assessed changed material, that report no longer approves the current material. Carry the known re-QA obligation in the update reason/handoff and subsequent `record-evidence --notes`, and repeat QA before close.
- If no optional QA existed, do not introduce it just because of an edit. If prior QA is unknown after context loss, recover its report or ask; never invent an approval or an exemption.
- `recertify` certifies scope-remediation chains, not routine task changes. Do not call it for this loop.

For an implementation defect with an unchanged task definition, use the already-existing `review --verdict fail` → implement → validate → `record-evidence` → `review` loop on the same active task. Do not create an emergent task merely because that task was already done.

Approval of a plan update never authorizes the operational/destructive actions described by its tasks. Those retain their own approvals.
