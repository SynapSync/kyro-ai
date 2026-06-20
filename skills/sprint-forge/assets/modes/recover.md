# Recover Mode

Recover Kyro when state, summaries, and Markdown disagree.

## Inputs

1. Read `.agents/kyro/kyro.json`.
2. Read scope `state.json` and `index.json` if present.
3. List available roadmap, sprint, summary, and `events.ndjson` files.
4. Prefer `events.ndjson` and summaries; open Markdown only for artifacts needed to rebuild missing structured state.

## Workflow

1. Identify the latest trustworthy artifact by timestamp and content completeness.
2. Rebuild missing or stale `state.json`, `index.json`, and `*.summary.json` from events first, then Markdown evidence as fallback.
3. Preserve user-authored Markdown; do not rewrite it unless fixing broken frontmatter or explicit state markers.
4. Report what was recovered and the next recommended route.

## Rules

- Prefer preserving user work over making state look clean.
- Never invent completed tasks without evidence.
- If multiple scopes are plausible, ask the user to choose before writing.
