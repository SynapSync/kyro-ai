# Review Task Mode

Validate completed Kyro work without loading unrelated lifecycle context.

## Inputs

1. Read `state.json`, `index.json`, and the active sprint summary.
2. Open the active sprint Markdown only for the completed task or phase.
3. Read `../helpers/reviewer.md` when classifying findings.
4. Read project-specific quality commands from config or repository scripts.

## Workflow

1. Verify task evidence matches actual code/docs changes.
2. Run relevant checks for the touched area.
3. Classify findings as critical, warning, or suggestion.
4. Block completion on critical issues.
5. Record warnings and suggestions in the sprint evidence or retro queue.
6. Refresh summaries after status changes.

## Rules

- Review happens during execution and at close.
- Do not mark tasks complete without evidence.
- Suggestions do not block, but they must be visible in retro inputs.
