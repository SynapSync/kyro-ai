# Kyro — Assets

Kyro assets are designed for progressive disclosure: load the router first, then only the mode/helper/template needed for the current action.

## modes/

| File | Description |
|------|-------------|
| [INIT.md](modes/INIT.md) | Lean analysis, justified sprint sizing, roadmap, scoped state, and summaries |
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
| [analysis/feature.md](helpers/analysis/feature.md) | Feature analysis and sizing signals |
| [analysis/bugfix.md](helpers/analysis/bugfix.md) | Bugfix analysis and sizing signals |
| [analysis/audit.md](helpers/analysis/audit.md) | Audit analysis and sizing signals |
| [analysis/refactor.md](helpers/analysis/refactor.md) | Refactor analysis and sizing signals |
| [analysis/new-project.md](helpers/analysis/new-project.md) | New project analysis and sizing signals |
| [analysis/tech-debt.md](helpers/analysis/tech-debt.md) | Tech debt analysis and sizing signals |
| [sprint-generator.md](helpers/sprint-generator.md) | Sprint generation algorithm |
| [debt-tracker.md](helpers/debt-tracker.md) | Accumulated debt rules |
| [reentry-generator.md](helpers/reentry-generator.md) | Re-entry prompt updates |
| [reviewer.md](helpers/reviewer.md) | Review classification |
| [handoff.md](helpers/handoff.md) | Session handoff format |

## protocols/

Protocol files are lazy-loaded only when a routed mode needs expanded detail: analysis, validation, debug, and gates.

## templates/

| File | Description |
|------|-------------|
| [ROADMAP.md](templates/ROADMAP.md) | Human roadmap evidence with sizingDecision |
| [SPRINT.md](templates/SPRINT.md) | Human sprint evidence |
| [PROJECT-README.md](templates/PROJECT-README.md) | Scope README |
| [REENTRY-PROMPTS.md](templates/REENTRY-PROMPTS.md) | Summary-first recovery prompts |
| [state.json](templates/state.json) | Scoped routing state |
| [index.json](templates/index.json) | Fast agent routing index |
| [ROADMAP.summary.json](templates/ROADMAP.summary.json) | Roadmap summary cache |
| [SPRINT.summary.json](templates/SPRINT.summary.json) | Sprint summary cache |
| [DEBT.summary.json](templates/DEBT.summary.json) | Debt summary cache |
| [rules.index.json](templates/rules.index.json) | Compact learned-rules index |
| [events.ndjson.example](templates/events.ndjson.example) | Compact execution event shape |

## fixtures/

| File | Description |
|------|-------------|
| [subcommands-and-reports.sizingDecision.json](fixtures/subcommands-and-reports.sizingDecision.json) | Regression fixture proving 3 justified sprints can be valid |
