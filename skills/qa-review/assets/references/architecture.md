# Architecture Review Reference

Use this reference when reviewing module boundaries, design decisions, maintainability, or scalability.

## Checklist

- Does the change respect existing ownership boundaries?
- Are new abstractions justified by real complexity or repetition?
- Is state stored in the right place and represented with structured data where possible?
- Are public interfaces stable and documented?
- Does the implementation preserve Kyro's portability across Claude Code, Cursor, Codex, OpenCode, Kilo Code, and generic LLM API hosts?

## Kyro-Specific Focus

- `agents/orchestrator.md` owns lifecycle coordination.
- `commands/*.md` should stay thin and delegate.
- `skills/*/SKILL.md` should route to assets instead of becoming monoliths.
- `.agents/sprint-forge/{scope}/` artifacts are workflow state, not throwaway notes.
