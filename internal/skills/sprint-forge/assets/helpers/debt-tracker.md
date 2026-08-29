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

Use `{{KYRO_CLI}} debt add|start|resolve|defer|escalate` — tool-owned and deterministic.

- `debt add --title <t> --priority <p> [--target <n>] [--note <t>]` — fresh id, `status: open`.
- `debt start <id>` — `open`/`deferred` to `in_progress`.
- `debt resolve <id> [--note <t>]` — `status: resolved`.
- `debt defer <id> --target <n> --note <t>` — `status: deferred` (both flags required).
- `debt escalate <id> --priority <p>` — raises priority only.

If the runtime or verb is unavailable, STOP without mutation. Report the observed version (or `not installed`) and `npx kyro-ai@latest sync --scope workspace --yes`; never edit `debt[]` by hand.

## Reporting

`/kyro:status` computes open / in_progress / resolved / deferred / critical counts and the oldest open item directly from `sprint.json.debt[]`. No summary file, no Markdown — one read.
