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
| scenario has no task | MEDIUM | Coverage gap |
| `spec.openQuestions[]` is non-empty | MEDIUM | Clarify should drain the queue |
| done + pass task has no `scenario_refs` | MEDIUM | Shipped work is untraceable to the spec |

Kyro checks the traceability graph is connected. It does not verify that a scenario truly validates its requirement or that a task truly implements a scenario; that judgment remains yours.

## Authorship model

Planning modes author the spec through the existing Artifact Write Contract:

- `INIT.md` may seed `requirements`, `nonGoals`, and `openQuestions`.
- `clarify.md` drains `openQuestions` into stable requirements or clarifications.
- `plan-sprint.md` writes Given/When/Then scenarios and task `scenario_refs`.

There is no `kyro spec` writer command. The tool owns validation, not planning authorship.

## Runtime surfaces

- `kyro analyze` emits spec findings and `close-sprint` blocks on HIGH findings through the existing close gate.
- `kyro context-pack --json` includes scope-level requirements/non-goals/open questions and task-level resolved scenarios.
- `kyro doctor --adapters` reports the honest enforcement tiers: structural checks are enforced or surfaced; semantic validation remains advisory.
