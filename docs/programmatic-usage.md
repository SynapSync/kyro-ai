# Programmatic Usage

Kyro can be used with any LLM API by loading its markdown instructions into your application's prompts. This is a programmatic adapter pattern, not a built-in runtime.

---

## Core Pattern

1. Load the relevant Kyro files.
2. Provide project context and artifact paths.
3. Ask the model to run a Kyro intent.
4. Save the generated markdown artifacts back to disk or your storage layer.

```pseudo
orchestrator = read("agents/orchestrator.md")
kyro_core = read("skills/sprint-forge/SKILL.md")
qa_review = read("skills/qa-review/SKILL.md")

system_prompt = join([
  orchestrator,
  kyro_core,
  qa_review
])

response = llm.generate({
  model: SELECTED_MODEL,
  system: system_prompt,
  input: """
  Run the forge intent for scope: oauth-implementation.
  Use artifact root: .agents/kyro/scopes/oauth-implementation/.
  Current project context:
  {PROJECT_CONTEXT}
  """
})

write_artifacts(response)
```

---

## Provider-Neutral Review Example

```pseudo
qa_review = read("skills/qa-review/SKILL.md")

response = llm.generate({
  model: STRONG_REVIEW_MODEL,
  system: qa_review,
  input: """
  Review this change using the qa-review skill.

  Files:
  {CHANGED_FILES}

  Diff:
  {DIFF}

  Return APPROVED, APPROVED WITH NOTES, CHANGES REQUIRED, or REJECTED.
  """
})
```

---

## Provider-Neutral Sprint Example

```pseudo
orchestrator = read("agents/orchestrator.md")
kyro_core = read("skills/sprint-forge/SKILL.md")

response = llm.generate({
  model: STRONG_PLANNING_MODEL,
  system: join([orchestrator, kyro_core]),
  input: """
  Run the status intent for .agents/kyro/scopes/{scope}/.
  Then generate the next sprint if the roadmap and previous sprint support it.
  """
})
```

---

## Artifact Contract

Your host application is responsible for persistence:

- Write findings to `.agents/kyro/scopes/{scope}/findings/`.
- Write sprint documents to `.agents/kyro/scopes/{scope}/phases/`.
- Keep `ROADMAP.md`, `RE-ENTRY-PROMPTS.md`, and `rules.md` in sync at sprint close or wrap-up, not during normal task execution.
- Run verification commands outside the model when possible.

---

## Model Guidance

Kyro does not require a specific provider or model family.

- Use a high-capability model for implementation, debugging, and architecture decisions.
- Use a faster/lower-cost model for read-only status reports or simple documentation review.
- Keep model names out of Kyro's sprint-forge artifacts unless you are recording which model modified a document.

---

## Safety Notes

- Treat model output as a patch proposal unless your host application validates and writes files explicitly.
- Keep secrets out of prompts.
- Run tests, typechecks, and builds outside the model.
- Preserve the markdown artifact layout so future agents can resume work.
