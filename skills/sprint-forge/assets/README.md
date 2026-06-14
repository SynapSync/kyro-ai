# Kyro — Assets

Kyro assets are designed for progressive disclosure: load the router first, then only the mode/helper/template needed for the current action.

## modes/

| File | Description |
|------|-------------|
| [INIT.md](modes/INIT.md) | Analysis, roadmap, scoped state, summaries, and scaffolding |
| [SPRINT.md](modes/SPRINT.md) | Lightweight sprint router |
| [plan-sprint.md](modes/plan-sprint.md) | Generate the next sprint |
| [execute-task.md](modes/execute-task.md) | Execute active sprint tasks |
| [review-task.md](modes/review-task.md) | Validate task or phase quality |
| [close-sprint.md](modes/close-sprint.md) | Retro, debt, summaries, and re-entry closeout |
| [recover.md](modes/recover.md) | Rebuild state/summaries after interruption |
| [STATUS.md](modes/STATUS.md) | Summary-first progress reporting |

## helpers/

| File | Description |
|------|-------------|
| [analysis-guide.md](helpers/analysis-guide.md) | Analysis strategy per work type |
| [sprint-generator.md](helpers/sprint-generator.md) | Sprint generation algorithm |
| [debt-tracker.md](helpers/debt-tracker.md) | Accumulated debt rules |
| [reentry-generator.md](helpers/reentry-generator.md) | Re-entry prompt updates |
| [reviewer.md](helpers/reviewer.md) | Review classification |
| [handoff.md](helpers/handoff.md) | Session handoff format |

## templates/

| File | Description |
|------|-------------|
| [ROADMAP.md](templates/ROADMAP.md) | Human roadmap evidence |
| [SPRINT.md](templates/SPRINT.md) | Human sprint evidence |
| [PROJECT-README.md](templates/PROJECT-README.md) | Scope README |
| [REENTRY-PROMPTS.md](templates/REENTRY-PROMPTS.md) | Human handoff prompts |
| [state.json](templates/state.json) | Scoped routing state |
| [index.json](templates/index.json) | Fast agent routing index |
| [ROADMAP.summary.json](templates/ROADMAP.summary.json) | Roadmap summary cache |
| [SPRINT.summary.json](templates/SPRINT.summary.json) | Sprint summary cache |
| [DEBT.summary.json](templates/DEBT.summary.json) | Debt summary cache |
