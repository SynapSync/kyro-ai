# Re-entry Generator Helper

Use only during INIT, sprint close, or wrap-up. Do not load during normal task execution.

## Purpose

`RE-ENTRY-PROMPTS.md` lets a fresh agent resume from structured state without rereading all Markdown.

## Update Points

- INIT: create prompts for first sprint, execution, status, and closeout.
- Sprint close: update next sprint, latest sprint, status, and quick reference.
- Wrap-up: point to the latest handoff and next action.

## Required Content

- Scope and codebase path.
- Ordered read list: `state.json`, `index.json`, relevant summaries, then Markdown only as fallback.
- Current sprint/status and next action.
- Quick reference table of sprint files and statuses.
- Important caveats: blockers, deferred debt, or required recovery.

## Process

1. Read existing `RE-ENTRY-PROMPTS.md` or the template when creating it.
2. Update only sections affected by INIT, close, or wrap-up.
3. Keep prompts summary-first; never instruct agents to open every sprint file by default.
4. Verify paths, current sprint, latest summary, and quick reference match actual artifacts.
