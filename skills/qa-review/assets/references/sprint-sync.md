# Sprint Synchronization Reference

Use this reference when validating work against sprint-forge artifacts.

## Required Checks

1. The implementation matches the sprint objective and task list.
2. Every previous recommendation appears in the current sprint disposition table.
3. The accumulated debt table is inherited complete.
4. New debt is appended, not hidden in prose.
5. Resolved debt changes status and records `Resolved In`.
6. Re-entry prompts point at the current sprint and latest completed sprint.
7. Roadmap status reflects completed sprints.

## Structured State

When `state.json` exists, treat it as the source of truth and markdown as the rendered view. Validate with:

```bash
npm run kyro:state -- validate {scope}
npm run kyro:debt-inherit -- --state {scope}
```
