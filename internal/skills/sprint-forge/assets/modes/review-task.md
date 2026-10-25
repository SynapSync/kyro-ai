# Review Task Mode

Validate completed work and record the verdict through the Kyro checker tool.

## Inputs

1. Task pack: `{{KYRO_CLI}} context-pack --kyro-scope {scope} --task <id> --json` — `taskAcceptanceCriteria`, `taskScenarios`, `nextTaskReview`. Do NOT open full `sprint.json`; verdict is CLI-owned (`{{KYRO_CLI}} review`).
2. Read `../helpers/reviewer.md` when classifying findings.

## Workflow

1. Verify the real changes in `taskFiles` satisfy `taskAcceptanceCriteria`.
2. Load `../protocols/validation.md`: reuse maker evidence only with a verifiable tested-state reference; otherwise rerun the affected focused checks.
3. Classify findings: critical, warning, suggestion. Critical blocks completion.
4. Tool-owned verdict:
   - Pass: `{{KYRO_CLI}} review <task-id> --kyro-scope <scope> --verdict pass --yes`
   - Fail: `{{KYRO_CLI}} review <task-id> --kyro-scope <scope> --verdict fail --finding critical:"…" --yes`
   - Use `--by <actor-id>` when known.
5. Tool refuses a pass → treat as blocking; return to execution. Never reuse a stale approval digest.
6. Active definition correction: load `../helpers/active-plan-update.md`. Historical tasks remain immutable.

## Opt-in checker delegate

**Default:** steps 1–5. **Opt-in** for maker-checker, independent review, or pack `delegationEnabled: true`:

1. **Must load** `../helpers/delegated-execution.md` and `../delegates/checker.md` before spawning.
2. Checker returns findings only; **only** `{{KYRO_CLI}} review` writes `task.verdict`.
3. Same maker must not be the checker when policy applies. No subagent → steps 1–5.

## Principles gate

- Non-negotiable `project.json.principles[]` violations are `fail`, not suggestions.
- `{{KYRO_CLI}} review` vetoes pass on malformed evidence, incomplete checked criteria, principle gates, verdict-before-evidence, or self-review policy.

## Rules

- No complete task without evidence and a passing verdict.
- Suggestions do not block; keep them in `task.verdict.findings` for retro.
- Do not hand-edit `task.verdict`.
- Unknown `review` command → runtime too old: ABORT (Startup handshake). Never hand-write a verdict.
