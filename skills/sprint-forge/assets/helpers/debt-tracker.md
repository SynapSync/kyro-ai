# Debt Tracker Helper

Use only for sprint planning debt carry-forward, explicit debt mutation, status debt reports, or sprint close.

## Principle

Debt never disappears. Rows are inherited across sprints and only change status when explicitly resolved, deferred, or moved in progress.

## Table Contract

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|---------------|--------|-------------|

- `#`: stable id; never reused.
- `Item`: actionable debt description.
- `Origin`: `INIT finding NN`, `Sprint N Phase X`, `Sprint N retro`, or `Sprint N generation`.
- `Sprint Target`: expected resolution sprint.
- `Status`: `open`, `in-progress`, `resolved`, or `deferred`.
- `Resolved In`: sprint number or `—`.

## Mutations

- New debt: append next id, status `open`, target best estimate, `Resolved In` = `—`.
- Start work: `open` or `deferred` → `in-progress`.
- Resolve: set `resolved`, fill `Resolved In`, and record validation evidence.
- Defer: set `deferred`, update target, and include a concrete reason.

## Reporting

STATUS can compute open, in-progress, resolved, deferred, critical, trend, and oldest open item from `DEBT.summary.json` first. Open sprint Markdown only when summary data is missing or a debt mutation is requested.
