# Maker/Checker Boundary

Kyro separates the task maker from the task checker where the boundary can be enforced deterministically.

## Honest contract

Kyro checks that you checked the right criteria — not that the code is correct. Criterion truth remains agent/human judgment.

Enforced by `kyro analyze`:

- `done` tasks must have valid evidence.
- `done` tasks must have a valid verdict.
- `pass` verdicts must include every task `acceptance_criteria` entry in `checked_criteria`. Matching is normalization-insensitive (ignores backticks, surrounding/collapsed whitespace, and case), and `kyro review` fails fast with the exact expected list when a supplied `--checked-criterion`/`--waive-criterion` matches no acceptance criterion.
- `pass` verdicts are blocked while non-negotiable principle gates are violated.
- Verdict timestamps must not predate evidence timestamps.
- Self-review is blocked only when policy enables `maker_checker.requireSeparateChecker`.

Always advisory:

- Whether the implementation actually satisfies prose acceptance criteria.

## Evidence schema

```json
{
  "summary": "Implemented the task.",
  "validation": "npm test -- demo",
  "files_changed": ["src/demo.ts"],
  "notes": "optional",
  "by": "maker",
  "recordedAt": "2026-07-02T00:00:00.000Z"
}
```

## Verdict schema

```json
{
  "result": "pass",
  "checked_criteria": ["Validation passes."],
  "findings": [],
  "by": "checker",
  "reviewedAt": "2026-07-02T00:01:00.000Z"
}
```

## Tool-owned evidence (maker)

The maker records evidence through the CLI instead of hand-editing `sprint.json`, so a whole-file
read/rewrite of the (10–20k token) sprint file is never needed just to record a task:

```bash
kyro record-evidence T1.1 --kyro-scope demo \
  --summary "Implemented the demo task." \
  --validation "npm test -- demo" \
  --file src/demo.ts
```

No `--yes` / `--confirm` on `record-evidence` (those flags are for `kyro review` and similar confirm
verbs). Passing `--yes` here fails with `INVALID_INPUT`.

It writes `task.evidence`, sets `task.status` (`done` by default; `--status blocked` after repeated
failures), and routes `handoff` to `review_task`. It never writes `task.verdict` — the checker owns
that. Multiple `--validation`/`--file` flags are accepted; `--by` defaults to `maker`.

`record-evidence` always stamps `recordedAt` with its own clock — evidence is safe by construction
at write time. The checker enforces this at read time: a `recordedAt` more than 5 minutes ahead of
the review clock (or unparsable) proves a hand-edit and vetoes the pass. The same 5-minute skew
tolerance applies to the verdict-predates-evidence ordering check, so honest cross-host clock drift
does not false-positive.

If the CLI rejects `record-evidence` or `review` as an unknown command, the installed runtime
predates these verbs. That is an abort condition — report `kyro --version` and upgrade — never a
license to hand-write evidence or verdicts. The orchestrator verifies this up front with the
`kyro capabilities` handshake (see [cli.md](cli.md)).

## Tool-owned review

```bash
kyro review T1.1 --kyro-scope demo --verdict pass --yes
kyro review T1.1 --kyro-scope demo --verdict fail --finding critical:"Missing test evidence" --yes
```

`--dry-run` and `--yes` are mutually exclusive on `review` (and `close-sprint`): preview or confirm, not both.

`review_task` defaults to `tool_owned`: the deterministic checker (coverage, evidence, self-review, principle vetoes) is the gate, and per-task review is reversible, so a pass does not need `--yes`. A project that wants a human confirmation on every review can set `review_task` to `confirm` in `policy.json`, after which CLI review needs `--yes` (the flag above is always safe to pass either way).

## Separate checker policy

```json
{
  "policyVersion": 1,
  "operations": {},
  "allow": [],
  "maker_checker": {
    "requireSeparateChecker": true
  }
}
```

When enabled, a `pass` where `verdict.by === evidence.by` is blocked as `SELF_REVIEW_BLOCKED`.

## Checker delegate (opt-in)

During `review_task`, the orchestrator may spawn a **fresh-context checker delegate** when maker-checker separation is needed or when `context-pack` reports `delegationEnabled: true` (L1).

| Rule | Detail |
|------|--------|
| Input | Lean brief from `kyro context-pack --task` — not full `sprint.json` |
| Output | Findings-only JSON (`findings[]`, `checkedCriteria[]`, `notes`) — no verdict |
| Verdict | **Only** `kyro review` writes `task.verdict` |
| Self-review | The implementer delegate must not be the checker when `requireSeparateChecker` applies |

If subagents are unavailable, the orchestrator reviews in `review-task` mode directly. See [Architecture — Delegated execution](architecture.md#delegated-execution-protocol-opt-in).

## Error codes

- `CONFIRMATION_REQUIRED` — a guarded operation needs explicit confirmation (only for review when `review_task` is set to `confirm` in policy).
- `CHECKER_FAILED` — deterministic checker findings vetoed the pass.
- `SELF_REVIEW_BLOCKED` — policy requires a separate checker actor.
- `CLARIFICATION_REQUIRED` — `record-evidence`/`review` refuse while any `[NEEDS CLARIFICATION]` marker remains; resolve them in clarify mode first. The gate counts only unresolved markers in the closed colon form `[NEEDS CLARIFICATION: <gap>]`; it ignores references that merely document the syntax — backtick-wrapped (`` `[NEEDS CLARIFICATION: …]` ``) or placeholder payloads (`<gap>`, `...`) — so a spec that talks *about* the marker does not trip the gate.
