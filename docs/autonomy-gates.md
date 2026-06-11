# Autonomy Gates

Kyro supports three gate modes in `config.json`:

| Mode | Behavior |
|------|----------|
| `strict` | Every configured gate asks the user before continuing. |
| `standard` | High-impact gates ask; low-risk implementation summaries may auto-continue. |
| `auto` | Gates auto-continue unless listed in `always_gate`. |

## Safety Floor

The default `always_gate` list contains:

- `sprint_plan`
- `commit`

Keep these defaults unless the project explicitly accepts unattended sprint execution and release handoff.

## Audit Trail

When a gate auto-continues, `npm run kyro:gate -- {scope} {gate_name}` records a `gate.auto_approved` entry in `{output_kyro_dir}/state.json`.

## Structured Prompt

When a gate requires input, agents should offer:

1. `proceed` — continue to the next phase.
2. `adjust` — revise the current artifact before continuing.
3. `cancel` — stop the workflow.
