# Idea Mode — Adaptive Pre-Scope Maturation

Produce an evidence-grounded, decision-complete artifact that another agent can scope or execute without re-interviewing the user. This mode is pre-scope: it never reads or mutates Kyro state.

## Inputs and permitted grounding

- The user's idea, conversation, and supplied reference paths.
- Read-only project evidence explicitly relevant to the idea: source, tests, documentation, manifests, schemas, and version history.
- Never read `.agents/kyro/project.json`, `.agents/kyro/local.json`, `.agents/kyro/scopes/`, `sprint.json`, installed runtime state, or secrets.
- Quote or record the source of decisive evidence. Label unsupported interpretations as hypotheses.

## 1. Detect the lane

Load `../helpers/classification-and-synthesis.md` and apply its lane algorithm exactly; it is the single source of truth for classification. Do not infer a second rule here. State the resulting lane briefly; the user may correct it.

- **Rough:** discover the minimum foundation, then deepen it.
- **Mature:** extract first, preserve settled decisions, find implications and contradictions, and never restart a generic interview.

## 2. Build the evidence ledger

Classify meaningful claims as `evidence`, `outcome`, `invariant`, `decision`, `constraint`, `hypothesis`, or `unknown`. For every decision, preserve rationale and tradeoff. For every success claim, derive an observable proof. For every invariant, identify the failure it prevents.

Do not draft from memory while references remain unread. When a path is missing or unreadable, say so and treat claims dependent on it as ungrounded.

## 3. Run the sufficiency loop

Load `../helpers/material-questions.md`. Ask exactly one highest-impact question only when a material gap remains: one question per turn. Stop after asking it and wait.

There is no arbitrary question or turn limit. Exit the loop when all are true:

- the causal problem and core thesis are explicit;
- primary users and the decisions they need to make are known;
- success and failure guarantees are observable;
- outcome boundaries and non-goals are coherent;
- material constraints, invariants, decisions, risks, and dependencies are represented;
- no contradiction or product/architecture decision required for execution is unresolved.

A user done-signal does not waive this gate. If the user ends early, produce a blocked maturity report naming the missing material decision; do not write a falsely executable plan.

## 4. Synthesize before drafting

Derive, in order: evidence → implication → invariant → observable outcome → failure mode → decision or material unknown. Build an execution blueprint with ordered workstreams, dependencies, deliverables, and validation gates. Name files, symbols, or APIs only when grounded; otherwise describe behavior-level work.

Load `../references/weak-to-strong.md` when the draft is descriptive, repetitive, or implementation-first.

## 5. Draft and score

Infer `plan` by default, `analysis` for viability/comparison without a build commitment, or `constitution` for durable project rules. Load `../templates/matured-idea.md` and draft every required section.

Load `../helpers/quality-rubric.md`. Score the complete draft. Revise until it reaches at least 90/100, every critical criterion is non-zero, and no material contradiction remains. A rubric score is evidence of coverage, not a claim of model perfection.

## 6. Confirm, persist, and verify

Show the inferred lane, `docType`, target `.agents/kyro/{docType}/{date}-{slug}.md`, quality score, and any non-blocking unknowns. Wait for confirmation or override.

Use exactly one artifact path. Write its initial content once. Directory creation for `{docType}` is allowed; scope/state creation is not. Re-read only that artifact and verify:

- frontmatter and required headings;
- all decisive source facts retained;
- decisions include rationale and tradeoffs;
- open questions include decision impact;
- blueprint and acceptance matrix are actionable;
- score remains at least 90/100.

If verification fails, one corrective overwrite of that same path is permitted, followed by one final verification. Never create a second artifact path or perform additional rewrites. Report path, lane, score, evidence sources, and suggest `/kyro:forge <slug>` for governed execution or direct use of the blueprint.
