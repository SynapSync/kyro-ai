# Orchestrator–Minion L1 opt-in

L1 adds an **explicit personal switch** and **role helpers** on top of [L0](orchestrator-minion-l0.md). Default remains single-agent; no L2 host adapters.

## Enable minion mode

Edit `.agents/kyro/local.json` (gitignored, personal layer):

```json
{
  "schemaVersion": 4,
  "activeScope": "my-scope",
  "installedAdapters": [],
  "execution": {
    "minionEnabled": true
  }
}
```

| Rule | Detail |
|------|--------|
| Storage | **local.json only** — not `project.json` (team-shared) |
| Default | Absent or `false` → single-agent forge (unchanged) |
| Install/sync | Never auto-enables; you opt in explicitly |
| Doctor | Validates `execution.minionEnabled` as boolean when present |

## What changes when enabled

`kyro context-pack --json` includes `"minionEnabled": true` so the orchestrator routes without hand-reading `local.json`.

| Mode | Helper loaded |
|------|----------------|
| `execute_task` | `skills/sprint-forge/assets/minions/implementer.md` |
| `review_task` | `skills/sprint-forge/assets/minions/checker.md` |

Contracts inherit L0: brief from task pack, status/findings JSON, write matrix (orchestrator + CLI own SoT), fallback when subagents unavailable.

## Verify

```bash
# After setting execution.minionEnabled in local.json
kyro context-pack --kyro-scope <scope> --json | jq .minionEnabled
# → true

kyro doctor   # local.json shape passes
```

Then in forge: *"ejecuta la siguiente task con minion"* and run the [L0 manual eval checklist](evals.md#l0-orchestratorminion-manual-eval-checklist).

## Out of scope (L1)

- Team-wide flag on `project.json`
- `kyro execute --minion` CLI
- L2 Task/worktree adapters
- Parallel task execution

## Related

- [orchestrator-minion-l0.md](orchestrator-minion-l0.md) — baseline protocol
- [teams.md](teams.md) — layered state field ownership
- [cli.md](cli.md) — `context-pack` fields
