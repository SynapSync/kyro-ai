# Spec Traceability

Kyro supports an optional minimal `spec` block inside `sprint.json` to connect planning intent to reviewed work:

```text
Requirement → Scenario → Task → Evidence → Validation → Verdict
```

This is not OpenSpec and does not create separate spec files. It is a small, tool-validated graph inside the existing sprint artifact.

## sprint.json shape

```json
{
  "spec": {
    "requirements": [
      { "id": "R1", "statement": "Users can complete checkout reliably.", "priority": "must", "rationale": "Checkout is the core outcome." }
    ],
    "scenarios": [
      { "id": "S1", "requirement": "R1", "given": "A valid cart", "when": "the user checks out", "then": "the order is confirmed" }
    ],
    "nonGoals": ["Payment-provider migration"],
    "openQuestions": []
  },
  "activeSprint": {
    "phases": [
      {
        "tasks": [
          { "id": "T1.1", "scenario_refs": ["S1"] }
        ]
      }
    ]
  }
}
```

`spec` and `task.scenario_refs` are additive and optional. `schemaVersion` remains `4`.

## Deterministic checks

`kyro analyze` checks graph structure, not semantic truth.

| Condition | Severity | Meaning |
| --- | --- | --- |
| `scenario.requirement` points to a missing requirement | HIGH | Broken graph; blocks close |
| `task.scenario_refs[]` points to a missing scenario | HIGH | Broken graph; blocks close |
| duplicate requirement or scenario id | MEDIUM | Visible consistency issue |
| requirement has no scenario | MEDIUM | Coverage gap |
| scenario has no **active or closed-sprint** task coverage | MEDIUM | Coverage gap (historical ledger/checkpoint refs count as covered) |
| `spec.openQuestions[]` is non-empty | MEDIUM | Clarify should drain the queue |
| done + pass task has no `scenario_refs` | MEDIUM | Shipped work is untraceable to the spec |

Kyro checks the traceability graph is connected. It does not verify that a scenario truly validates its requirement or that a task truly implements a scenario; that judgment remains yours.

### Closed-sprint coverage

After `close-sprint`, scenarios that were linked on tasks in the closed sprint remain in `spec.scenarios`. Analyze reads ledger `checkpoint` / `snapshot` archives and treats those historical `scenario_refs` as covered so the next active sprint does not re-flag them as MEDIUM "no task coverage". Do **not** delete historical scenarios to silence analyze.

## Authorship model

Planning modes author the spec through the existing Artifact Write Contract:

- `INIT.md` may seed `requirements`, `nonGoals`, and `openQuestions`.
- `clarify.md` drains `openQuestions` into stable requirements or clarifications.
- `plan-sprint.md` / `kyro plan --from` writes Given/When/Then scenarios and task `scenario_refs`.
- After a sprint is active, agents refine the graph with tool-owned CLI (no hand-edit):
  - `kyro scenario add --id S# --requirement R# --given … --when … --then …`
  - `kyro scenario link --task T# --scenario S#`

The tool owns validation and these graph mutations; agents must not whole-file rewrite `sprint.json` for scenario coverage.

## Runtime surfaces

- `kyro analyze` emits spec findings and `close-sprint` blocks on HIGH findings through the existing close gate.
- `kyro context-pack --json` includes scope-level requirements/non-goals/open questions and task-level resolved scenarios.
- `kyro doctor --adapters` reports the honest enforcement tiers: structural checks are enforced or surfaced; semantic validation remains advisory.
