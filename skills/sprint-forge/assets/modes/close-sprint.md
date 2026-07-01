# Close Sprint Mode

Close a sprint by snapshotting it verbatim, recording a one-line ledger entry, then clearing `activeSprint`. Zero loss: the full structured record is preserved in the archive snapshot.

**The destructive step is NOT done by hand. It is owned by the CLI.** You prepare the additive work (narrative, conventions, debt); then a single command — `kyro close-sprint` — snapshots `activeSprint` to `archive/` and only then clears it, atomically, and re-parses to verify. This is non-negotiable: a hand-edited close is how Sprint data has been lost before. Do **not** manually null `activeSprint` or hand-write the ledger entry.

Additive `sprint.json` mutations (conventions, debt) use the Artifact Write Contract in `../../SKILL.md` (read → parse → mutate object → overwrite whole file → re-parse).

## Inputs

1. Read `.agents/kyro/scopes/{scope}/sprint.json`. The complete sprint detail is in `activeSprint` (phases → tasks with `evidence` and `verdict`).
2. Read `../helpers/debt-tracker.md` before changing `debt[]`.
3. Read `../helpers/learner.md` before extracting `conventions[]`.

## Workflow

1. Run the pre-close quality checkpoint. Confirm every task has `status: "done"` and a passing `verdict` (or is explicitly carried/blocked with reason). **Run `kyro analyze --kyro-scope {scope}` and do not proceed while any CRITICAL or HIGH finding remains** — resolve them first (route to `clarify` for `[NEEDS CLARIFICATION]` markers).
2. Fill the retro reasoning: went well, did not go well, surprises, new debt. Capture recommendations for Sprint N+1 (you will pass them to the close command).
3. **Additive writes first (safe-write).** These must happen before the close command, because the command re-serializes the current `sprint.json`:
   - Extract learned rules as `conventions[]` objects via `../helpers/learner.md` — each `{ id, rule, tags, addedSprint }`. Append to `sprint.json.conventions[]`.
   - Update `debt[]` via `../helpers/debt-tracker.md`: mark resolved items `resolved`, defer with reason, add new debt objects.
4. **Do NOT hand-write the narrative `.md`.** The CLI renders it deterministically from the snapshot (the title comes from `roadmap.sprints[]`, so it can never be `undefined`). You only supply the *judgment* text — learnings and recommendations — as flags to the close command in the next step.

### 5. Close with the CLI (deterministic, zero-loss)

Run:

```
kyro close-sprint --kyro-scope {scope} --outcome {shipped|partial|...} \
  [--note "handoff note for next session"] \
  [--summary "one-line previousSprint summary"] \
  [--learning "..."]          # repeatable — recorded in the narrative
  [--recommendation "..."]    # repeatable — recorded in the narrative + ledger
```

In one atomic operation the command snapshots `activeSprint` to `archive/` (double-close protected), renders the narrative `.md` deterministically, appends the `ledger[]` entry, clears `activeSprint`, routes `handoff.nextAction` (`plan_sprint` or `wrap_up`), and re-parses to verify. The snapshot always survives even if the final write fails.

Use `--dry-run` first if you want to review the plan. Do not replicate this by hand.

## Rules

- The destructive snapshot+clear AND the narrative render are the CLI's job, never a manual edit. The JSON snapshot is the complete record; the `.md` is the readable narrative the CLI generates; the `ledger[]` entry is the one-line index.
- Retro must be honest and specific. Recommendations must point to concrete next actions.
- Debt is never deleted; resolved debt appears in the archive and is dropped from `debt[]` only after it is recorded there.
- Never create `state.json`, `index.json`, `events.ndjson`, summaries, `RE-ENTRY-PROMPTS.md`, or `phases/`.
