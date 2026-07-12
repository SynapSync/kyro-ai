# Seedbed-to-INIT Schema Mapping

Use only when INIT receives a plan-grade matured-idea document. Never add fields outside the v4 schema.

| Seedbed content | `sprint.json` target |
| --- | --- |
| Core thesis + problem | Distill to `objective`; causal detail goes in applicable `spec.requirements[].rationale`. |
| Success outcomes | One falsifiable entry each in `successCriteria[]`. |
| In-scope outcomes | Stable `spec.requirements[]` ids (`R1...`); supplied priority or `must`. |
| Invariants and failure guarantees | One `must` requirement each; prevented failure and source evidence in `rationale`. Never use `conventions[]`, which is reserved for learned sprint rules. |
| Closed decisions | Externally normative decisions become requirements whose `rationale` preserves choice, evidence, tradeoff, and consequence. Delivery-only decisions go verbatim in `roadmap.sizingRationale` and the relevant planned sprint objective. |
| Explicit exclusions | `spec.nonGoals[]`. |
| Material questions | `spec.openQuestions[]` as `question — impact: ...`; force `handoff.nextAction: "clarify"`. |
| Acceptance matrix | Grounded Given/When/Then rows become `spec.scenarios[]` (`S1...`) linked to requirement ids. Put expected validation method in the requirement `rationale`; later tasks copy it into `acceptance_criteria`. Never fabricate executed `task.evidence`. |
| Blueprint dependencies/order | Define `roadmap.sprints[]` order and dependency chain in `roadmap.sizingRationale`. INIT creates no tasks. |
| Current evidence + Forge handoff | Feed requirement rationales, non-goals, open questions, roadmap ordering, and sizing rationale. |

Account for every invariant, guarantee, closed decision, dependency, validation row, and material question. If any material item has no destination above, stop and report an unmapped blocker before writing.
