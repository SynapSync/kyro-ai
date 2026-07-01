# Debt Tracker Helper

Use only for sprint planning debt carry-forward, explicit debt mutation, status debt reports, or sprint close. Debt lives in `sprint.json.debt[]` — there is no `DEBT.summary.json` or debt Markdown table in v4.

## Principle

Debt never disappears. Items are inherited across sprints and only change status when explicitly resolved, deferred, or moved in progress.

## Debt item shape (`sprint.json.debt[]`)

```json
{ "id": "debt-3", "title": "OnPush not applied to table component", "origin": 1,
  "priority": "medium", "status": "open", "targetSprint": 3, "note": "" }
```

- `id`: stable, never reused (e.g. `debt-3`).
- `title`: actionable debt description.
- `origin`: sprint number where the debt was first recorded.
- `priority`: `critical | high | medium | low`.
- `status`: `open | in_progress | resolved | deferred` (snake_case).
- `targetSprint`: expected resolution sprint, or `null`.
- `note`: reason / context (required when deferring).

## Mutations

All edits go through the Artifact Write Contract in `../../SKILL.md` (read → parse → mutate `debt[]` in memory → overwrite the whole `sprint.json` → re-parse). Do not splice array items with a string edit.

- New debt: append with a fresh `id`, `status: "open"`, best-estimate `targetSprint`.
- Start work: `open` or `deferred` → `in_progress`.
- Resolve: set `status: "resolved"` and record validation evidence. At sprint close, resolved items appear in the archive, then are dropped from `debt[]`.
- Defer: set `status: "deferred"`, update `targetSprint`, and include a concrete reason in `note`.

## Reporting

`/kyro:status` computes open / in_progress / resolved / deferred / critical counts and the oldest open item directly from `sprint.json.debt[]`. No summary file, no Markdown — one read.
