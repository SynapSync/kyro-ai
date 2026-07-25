# Review Task Mode

Validate completed work and record the verdict through the Kyro checker tool.

## Inputs

1. Task pack: `{{KYRO_CLI}} context-pack --kyro-scope {scope} --task <id> --json` — `taskAcceptanceCriteria`, `taskScenarios`, `nextTaskReview`. Do NOT open full `sprint.json`; verdict is CLI-owned (`{{KYRO_CLI}} review`).
2. Verify real changes in `taskFiles` against `taskAcceptanceCriteria`. Pack omits evidence; `{{KYRO_CLI}} review` checks shape and criteria coverage.
3. Read `../helpers/reviewer.md` when classifying findings.

## Workflow

1. Verify `taskFiles` satisfy `taskAcceptanceCriteria`.
2. Run touched-area checks only: targeted tests, scoped/capped searches.
3. Classify findings: critical, warning, suggestion. Critical blocks completion.
4. Tool-owned verdict:
   - Pass: `{{KYRO_CLI}} review <task-id> --kyro-scope <scope> --verdict pass --yes`
   - Fail: `{{KYRO_CLI}} review <task-id> --kyro-scope <scope> --verdict fail --finding critical:"…" --yes`
   - Use `--by <actor-id>` when known.
5. Tool refuses a pass → treat as blocking finding; route back to execution.

## Opt-in checker delegate

**Default:** steps 1–5. **Opt-in** for maker-checker separation, independent review, or `delegationEnabled: true`:

1. Load `../helpers/delegated-execution.md` and `../delegates/checker.md` (findings only).
2. Verdict only via `{{KYRO_CLI}} review`.
3. No subagent → steps 1–5.

## Principles gate

- Non-negotiable `kyro.json.principles[]` violations are `fail`, not suggestions.
- `{{KYRO_CLI}} review` vetoes pass on malformed evidence, incomplete checked criteria, principle gates, verdict-before-evidence, or self-review policy.

## Rules

- No complete task without evidence and a passing verdict.
- Suggestions do not block; keep them in `task.verdict.findings` for retro.
- Do not hand-edit `task.verdict`.
