# Finding 02 — Task-specific context selection is still prompt-driven

## Summary
The backlog requires `--task <id>` context packs so execution paths load task-relevant files, rules, and validation criteria instead of broad sprint Markdown.

## Severity
P1 — direct token-cost reducer.

## Affected files or modules
- `src/cli/commands/context-pack.ts`
- `src/cli/artifacts/schema.ts`
- `.agents/kyro/scopes/*/index.json`
- `.agents/kyro/scopes/rules.index.json`
- `skills/sprint-forge/assets/modes/execute-task.md`

## User-visible behavior
`kyro context-pack --kyro-scope <scope> --task <id>` should emit only the active task, likely touched files, verification criteria, matching rules, and compact evidence paths.

## Details
The lean runtime now prevents eager helper loading, but it does not yet give agents a deterministic task context bundle. Agents may still open long Markdown when they only need a task slice.

## Recommendation
After the base command exists, add task lookup from active sprint summaries/index state, include matching `rules.index.json` entries, and fall back to Markdown paths only as references when summaries are insufficient.

## Validation
- Fixture with active sprint and next task.
- Fixture proving unrelated sprint Markdown is not embedded.
- Token budget assertion for active task packs.
