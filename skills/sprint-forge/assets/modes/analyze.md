# Analyze Mode

Run a semantic cross-check of the scope before a gate (sprint close, milestone, or on demand). Where
`kyro doctor` validates the SHAPE of `sprint.json`, `kyro analyze` validates its MEANING. Read-only —
it writes nothing.

## How to run

```
kyro analyze --kyro-scope {scope} [--json]
```

The command reports severity-triaged findings and exits non-zero when any **CRITICAL** or **HIGH**
finding exists:

- **CRITICAL** — unresolved `[NEEDS CLARIFICATION]` markers; an active sprint with zero tasks; a task
  with no `acceptance_criteria`; a violated non-negotiable principle.
- **HIGH** — `depends_on` referencing a task id that does not exist; debt overdue from an earlier
  sprint still open.
- **MEDIUM** — missing `successCriteria`; duplicate task ids.
- **LOW** — style.

## When to use it

- **Gate before `close_sprint`**: run `kyro analyze` first. Do not close while CRITICAL/HIGH findings
  remain — fix them (or route to `clarify` for markers), then close.
- **During `recover`**: use it to locate what is inconsistent.
- **On demand / `STATUS`**: a quick health read of the active scope.

## Acting on findings

- CRITICAL/HIGH block: resolve by editing `sprint.json` via the Artifact Write Contract, or route to
  the right mode (`clarify` for markers, `plan-sprint` for coverage/dependency fixes).
- MEDIUM/LOW are advisory; address opportunistically and note in the retro.

## Rules

- `analyze` never writes — it only reports. Fixes go through the owning mode's safe-write.
- Do not advance past a gate with CRITICAL/HIGH findings; that is exactly the drift this prevents.
