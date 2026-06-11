# Debt Tracker

This helper defines the rules for the Accumulated Technical Debt table that persists across sprints.

---

## Core Principle

> **Debt never disappears.** The debt table is a living ledger that grows as new debt is discovered and shrinks only when debt is explicitly resolved. It is never pruned, never reset, never "cleaned up."

As of Kyro 3.5, debt is stored in `{output_kyro_dir}/state.json`. Markdown debt tables are rendered views. Agents should update debt through the state CLI instead of hand-editing generated tables.

```bash
npm run kyro:state -- add-debt {scope} --item "..." --origin "Sprint N Phase X" --target "Sprint M"
npm run kyro:state -- resolve-debt {scope} --id 1 --sprint "Sprint N"
npm run kyro:debt-inherit -- --state {scope}
```

---

## Table Format

The rendered debt table appears in every sprint file, starting from Sprint 1:

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1 | Brief description of debt item | Where it was discovered | Sprint N | open | — |

### Column Definitions

| Column | Description |
|--------|-------------|
| **#** | Sequential number. Never reused, even if the item is resolved. New items get the next available number. |
| **Item** | Brief, clear description of the debt. Specific enough to act on. |
| **Origin** | Where and when the debt was discovered. Format: `Sprint {N} Phase {X}`, `INIT finding {NN}`, or `Sprint {N} retro`. |
| **Sprint Target** | Which sprint is expected to resolve this item. Updated if deferred. |
| **Status** | Current state: `open`, `in-progress`, `resolved`, `deferred`. |
| **Resolved In** | Sprint number where the item was actually resolved. Empty (`—`) if not yet resolved. |

---

## Status Transitions

```
open → in-progress → resolved
  ↓
deferred → open → in-progress → resolved
```

- **open**: Known but not yet being worked on
- **in-progress**: Actively being addressed in the current sprint
- **resolved**: Fixed and verified. Record the sprint number.
- **deferred**: Postponed to a later sprint. Requires justification.

---

## Inheritance Rules

1. **Sprint 1**: The debt table starts with items discovered during INIT analysis (if any) or is empty.
2. **Sprint N (N > 1)**: Copy the ENTIRE debt table from Sprint N-1. Do not omit resolved items — they remain as history.
3. **Add new items**: Append at the bottom with the next available number.
4. **Never delete rows**: Even resolved items stay in the table. The table is a complete history.
5. **Preserve original numbers**: Item #3 is always Item #3, regardless of how many sprints pass.

---

## Adding New Debt

New debt can be discovered at any point:

- **During INIT analysis**: Origin = `INIT finding {NN}`
- **During sprint generation**: Origin = `Sprint {N} generation` (from recommendations or roadmap analysis)
- **During sprint execution**: Origin = `Sprint {N} Phase {X}` (specific phase where discovered)
- **During sprint retro**: Origin = `Sprint {N} retro`

When adding a new item:
1. Call `npm run kyro:state -- add-debt {scope} --item "..." --origin "..." --target "Sprint N"`.
2. Render markdown views with `npm run kyro:render-state -- {scope} debt`.
3. Do not manually renumber debt rows.

---

## Closing Debt

When a debt item is resolved during a sprint:

1. Call `npm run kyro:state -- resolve-debt {scope} --id {id} --sprint "Sprint N"`.
2. Render markdown views with `npm run kyro:render-state -- {scope} debt`.
3. Do not delete the row from state or markdown history.

---

## Deferring Debt

When a debt item cannot be addressed in its target sprint:

1. Change Status to `deferred`
2. Update Sprint Target to the new expected sprint
3. Add justification — either inline or as a footnote:
   - Inline: `deferred (blocked by external API release)`
   - Footnote: `deferred [^1]` with `[^1]: Blocked by external API release, expected Sprint 5`

**Rule**: Deferral must be justified. "Not enough time" is acceptable only with specifics (e.g., "sprint scope expanded due to emergent phase, deferring to Sprint 4").

---

## Reporting

The STATUS mode uses the debt table for reporting:

- **Open count**: Items with status `open` or `in-progress`
- **Resolved count**: Items with status `resolved`
- **Deferred count**: Items with status `deferred`
- **Debt trend**: Is the open count growing or shrinking sprint over sprint?
- **Oldest open items**: Items that have been open the longest (potential chronic debt)

---

## Example

Sprint 3's debt table, showing history from sprints 1-3:

| # | Item | Origin | Sprint Target | Status | Resolved In |
|---|------|--------|--------------|--------|-------------|
| 1 | Missing unit tests for auth module | INIT finding 02 | Sprint 2 | resolved | Sprint 2 |
| 2 | Deprecated API calls in data layer | INIT finding 03 | Sprint 3 | in-progress | — |
| 3 | Inconsistent error handling in controllers | Sprint 1 Phase 2 | Sprint 3 | open | — |
| 4 | No input validation on user forms | Sprint 2 retro | Sprint 4 | deferred | — |
| 5 | Circular dependency between modules A and B | Sprint 3 Phase 1 | Sprint 4 | open | — |
