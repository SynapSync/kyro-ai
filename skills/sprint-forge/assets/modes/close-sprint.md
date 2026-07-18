# Close Sprint Mode

Close a sprint by publishing a versioned lossless scope checkpoint, retaining the legacy verbatim ActiveSprint snapshot, recording a ledger entry, then clearing `activeSprint`.

**The destructive step is NOT done by hand. It is owned by the CLI.** The command first publishes an immutable checkpoint containing complete `sprint.json` and affected `kyro.json` scope state before and after close. It then writes the compatible ActiveSprint snapshot and narrative and reconciles live state with compare-and-swap checks. Do **not** manually null `activeSprint` or hand-write the ledger entry.

Additive `sprint.json` mutations (conventions, debt) use the Artifact Write Contract in `../../SKILL.md` (read → parse → mutate object → overwrite whole file → re-parse).

## Inputs

1. Read `.agents/kyro/scopes/{scope}/sprint.json`. The complete sprint detail is in `activeSprint` (phases → tasks with `evidence` and `verdict`).
2. Read `../helpers/debt-tracker.md` before changing `debt[]`.
3. Read `../helpers/learner.md` before extracting `conventions[]`.

## Workflow

1. Run the pre-close quality checkpoint. Confirm every task has `status: "done"` and a passing `verdict` (or is explicitly carried/blocked with reason). **Run `{{KYRO_CLI}} analyze --kyro-scope {scope}` and do not proceed while any CRITICAL or HIGH finding remains** — resolve them first (route to `clarify` for `[NEEDS CLARIFICATION]` markers).
2. Fill the retro reasoning: went well, did not go well, surprises, new debt. Capture recommendations for Sprint N+1 (you will pass them to the close command).
3. **Additive writes first (safe-write).** These must happen before the close command, because the command re-serializes the current `sprint.json`:
   - Extract learned rules as `conventions[]` objects via `../helpers/learner.md` — each `{ id, rule, tags, addedSprint }`. Append to `sprint.json.conventions[]`.
   - Update `debt[]` via `../helpers/debt-tracker.md`: mark resolved items `resolved`, defer with reason, add new debt objects.
4. **Do NOT hand-write the narrative `.md`.** The CLI renders it deterministically from the snapshot (the title comes from `roadmap.sprints[]`, so it can never be `undefined`). You only supply the *judgment* text — learnings and recommendations — as flags to the close command in the next step.

### 5. Close with the CLI (deterministic, lossless)

Run:

```
{{KYRO_CLI}} close-sprint --kyro-scope {scope} --outcome {shipped|partial|...} \
  [--note "handoff note for next session"] \
  [--summary "one-line previousSprint summary"] \
  [--learning "..."]          # repeatable — recorded in the narrative
  [--recommendation "..."]    # repeatable — recorded in the narrative + ledger
```

The command publishes `sprint-NNN-slug.checkpoint.json` first, then the legacy `sprint-NNN-slug.json` ActiveSprint snapshot and narrative. It atomically reconciles `sprint.json` and only the affected `kyro.json` scope entry. A retry with the same frozen inputs resumes safely; corrupt, unsupported, conflicting, or divergent state stops without overwriting live work.

Use `--dry-run` first if you want to review the plan. Do not replicate this by hand.

## Hand off for a fresh session

After the CLI reports `Next action: plan_sprint` (sprints remain), the next sprint must start
in a **fresh session** — continuing here carries the whole session's context, the biggest cost
driver across a multi-sprint run. Do NOT auto-start the next sprint now. Generate the
continuation prompt via the task-context capability (`/kyro:task-context`, or the
`kyro-task-context` skill) and present it in a fenced block for the user to paste into a new
session. When the CLI reports `Next action: wrap_up`, the scope is complete — no more sprints to plan.

## Rules

- Checkpoint, legacy snapshot, clear, and narrative rendering are the CLI's job. The checkpoint is the complete recovery record; the legacy JSON contains only `activeSprint`; the `.md` is human-readable; `ledger[]` indexes all three.
- Retro must be honest and specific. Recommendations must point to concrete next actions.
- Debt is never deleted; resolved debt appears in the archive and is dropped from `debt[]` only after it is recorded there.
- Never create `state.json`, `index.json`, `events.ndjson`, summaries, `RE-ENTRY-PROMPTS.md`, or `phases/`.
