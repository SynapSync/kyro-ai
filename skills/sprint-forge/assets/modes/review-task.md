# Review Task Mode

Validate completed work and record the verdict through the Kyro checker tool.

## Inputs

1. Read the task pack: `{{KYRO_CLI}} context-pack --kyro-scope {scope} --task <id> --json` (`handoff.nextTaskId`) — `taskAcceptanceCriteria`, `taskScenarios`, `nextTaskReview` (`hasPassVerdict`, `checkerFindings`). Do NOT open the full `sprint.json`; the verdict write is CLI-owned (`{{KYRO_CLI}} review`).
2. Review the just-executed task: verify the real changes in `taskFiles` satisfy `taskAcceptanceCriteria`. The pack omits the recorded `evidence` blob — you don't need it; `{{KYRO_CLI}} review` validates its shape and criteria-coverage.
3. Read `../helpers/reviewer.md` when classifying findings.

## Workflow

1. Verify the real changes in `taskFiles` satisfy `taskAcceptanceCriteria`.
2. Run only touched-area checks: targeted tests, scoped/capped searches.
3. Classify findings as critical, warning, or suggestion. Critical issues block completion.
4. Let the tool own the verdict write:
   - Passing review: `{{KYRO_CLI}} review <task-id> --kyro-scope <scope> --verdict pass --yes`
   - Failing review: `{{KYRO_CLI}} review <task-id> --kyro-scope <scope> --verdict fail --finding critical:"<detail>" --yes`
   - Use `--by <actor-id>` when the checker actor id is known.
5. If the tool refuses a pass, treat the refusal as a blocking checker finding and route back to execution.

## Opt-in checker delegate (L0)

**Default:** orchestrator reviews in this mode (steps 1–5). **Opt-in:** spawn a **fresh-context checker delegate** when maker-checker separation or a clean second opinion is needed, or when `context-pack` reports `delegationEnabled: true`.

### L1 routing (`delegationEnabled` from context-pack)

When the task pack JSON includes `"delegationEnabled": true`:

1. Load `../delegates/checker.md` — findings-only contract for the checker worker.
2. Follow the L0 checker rules below; materialize verdict only via `{{KYRO_CLI}} review`.
3. If the host cannot spawn a subagent, fall back to orchestrator-led review (steps 1–5).

When `delegationEnabled` is `false` or absent, use steps 1–5 only (L0 checker delegate prose applies when the user explicitly requests it).

### When to use

- Maker-checker policy requires a checker distinct from the implementer.
- User asks for an independent review pass.
- Task risk warrants a separate context (security, architecture).

### Checker delegate contract

The checker delegate receives a brief from the task pack (same lean principle as execute — no full `sprint.json`). It returns **findings only**, for example:

```json
{
  "taskId": "T1.1",
  "findings": [
    { "severity": "critical | warning | suggestion", "detail": "…" }
  ],
  "recommendation": "pass | fail",
  "notes": "optional"
}
```

| Rule | Detail |
|------|--------|
| Verdict write | **Only** `{{KYRO_CLI}} review` materializes `task.verdict` — the checker delegate does not hand-edit sprint state |
| Self-review | The **same** delegate that implemented the task must **not** be the checker when maker-checker policy applies |
| Orchestrator role | Interpret findings, run targeted checks if needed, then invoke `kyro review` with `--verdict pass` or `--finding critical:…` |

If subagents are unavailable, fall back to orchestrator-led review in this mode (steps 1–5).

See also: `docs/architecture.md` (delegated execution protocol), `docs/maker-checker.md` (checker delegate).

## Principles gate

- Before passing a task, confirm its change does not violate a `non-negotiable` principle in
  `kyro.json.principles[]`. A violation is a `fail` finding, not a suggestion.
- `{{KYRO_CLI}} review` deterministically vetoes a pass when evidence is malformed, checked criteria do
  not cover the task acceptance criteria, a non-negotiable principle gate is violated, the verdict
  predates evidence, or policy forbids self-review.

## Rules

- Do not mark a task complete without evidence and a passing verdict.
- Suggestions do not block, but must be visible in `task.verdict.findings` for the retro.
- Do not hand-edit `task.verdict`; the checker write is tool-owned.
