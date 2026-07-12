---
name: seedbed
description: "Trigger: mature rough or mature ideas before scope creation. Produce evidence-grounded, decision-complete, execution-ready briefs."
license: Apache-2.0
metadata:
  author: synapsync
  version: "2.0"
  scope: [root]
---

## Activation Contract

Use for `/kyro:idea` or when the user wants to deepen an idea before creating a Kyro scope. Accept a one-line concept, mature brief, reference document, or authorized project evidence.

## Hard Rules

- Remain pre-scope: never read or mutate `kyro.json`, `scopes/`, `sprint.json`, or runtime state.
- Read only user-provided references and relevant read-only project evidence; distinguish evidence from inference.
- Ask one question per turn, only when its answer materially changes the result. Never re-ask known facts.
- Never hide contradictions, invent decisions, or present an unresolved material choice as settled.
- Use one confirmed `.agents/kyro/{docType}/{date}-{slug}.md` path: one initial write and, only after failed verification, at most one corrective overwrite of that path.
- Persist only after the 90/100 quality gate passes.

## Decision Gates

| Signal | Route |
| --- | --- |
| Lane not established | Apply only the algorithm in `classification-and-synthesis.md` |
| Material contradiction or decision gap remains | Ask one highest-impact question |
| Sufficiency gate and quality gate pass | Confirm path, write, validate |

## Execution Steps

1. Load `assets/modes/idea.md` and follow its adaptive workflow.
2. Load classification, question, and quality helpers only when the mode requests them.
3. Load `assets/templates/matured-idea.md` immediately before drafting.
4. Confirm the path, write once, re-read the output, and report the score and any explicit non-blocking unknowns.
5. Offer `/kyro:forge` as governed execution while keeping the artifact independently actionable.

## Output Contract

Return the written path, detected lane, quality score with criterion totals, evidence sources, and recommended next action. If blocked, return the single material decision needed next instead of a file.

## References

- `assets/modes/idea.md` — adaptive workflow.
- `assets/helpers/classification-and-synthesis.md` — evidence model and synthesis.
- `assets/helpers/material-questions.md` — question selection.
- `assets/helpers/quality-rubric.md` — persistence gate.
- `assets/references/weak-to-strong.md` — transformation examples.
- `assets/templates/matured-idea.md` — output contract.
