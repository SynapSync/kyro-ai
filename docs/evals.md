# Behavioral Evals

`kyro eval` runs deterministic, agent-facing regression cases. It does not call an LLM. Each case replays the CLI/tool behavior an agent depends on: routing, command outcomes, and final artifact state.

## Run

```bash
kyro eval
kyro eval --json
kyro eval --list
kyro eval --case close-sprint-happy
kyro eval --tag routing
kyro eval --agent opencode
kyro eval --keep-sandbox
```

Exit codes:

- `0` — all selected cases passed.
- `1` — at least one expectation failed.
- `2` — harness error, such as malformed manifest, empty selection, or missing `dist/cli.js`.

## Case layout

```text
fixtures/evals/<case-id>/
├── case.json
├── state/
│   └── .agents/kyro/...
└── expected/
    └── sprint.json
```

`state/` is copied into an isolated temp sandbox. Every step runs against the built CLI (`dist/cli.js`) with an isolated `HOME`.

## Manifest

```json
{
  "evalCaseSchemaVersion": 1,
  "id": "close-sprint-happy",
  "title": "Close sprint snapshots and clears active sprint",
  "kind": "replay",
  "tags": ["close-sprint", "happy"],
  "agents": ["any"],
  "scope": "demo",
  "route": {
    "nextAction": "close_sprint",
    "expectedModes": ["SPRINT.md", "close-sprint.md"],
    "expectedBudgetClass": "close",
    "expectedReasoningTier": "deep"
  },
  "steps": [
    {
      "run": ["close-sprint", "--kyro-scope", "demo", "--outcome", "shipped", "--yes"],
      "expect": {
        "exitCode": 0,
        "stdoutIncludes": ["Sprint 1 closed"]
      }
    }
  ],
  "expectFinalState": true
}
```

Unknown keys are rejected. A malformed case fails the suite with exit code `2`; it is never skipped silently.

## Final-state normalization

When `expectFinalState` is true, `expected/sprint.json` is compared with the sandbox result after normalization:

- `handoff.lastUpdated`, `ledger[].closedAt`, and `clarifications[].date` become `"<NORMALIZED>"`.
- Absolute sandbox paths become `<SANDBOX>/...`.
- Nothing else is normalized. Array order remains significant.

## Built-in seed suite

The repository ships a seed suite under `fixtures/evals/` covering:

- routing for every `handoff.nextAction`;
- guardrails for missing close snapshots, clarification markers, broken dependencies, duplicate task ids, and repair shape drift;
- happy paths for `close-sprint` and task-mode `context-pack`;
- adapter filtering through `detect --agent opencode --json`.

`npm run check` runs the suite through `check:eval`.
