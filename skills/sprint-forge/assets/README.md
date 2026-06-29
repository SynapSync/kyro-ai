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

v4 installs exactly these. The two JSON files are the agent-facing source of truth; the markdown is a write-only human archive.

| File | Description |
|------|-------------|
| [sprint.json](templates/sprint.json) | Single source of truth per scope (objective, conventions, roadmap, ledger, activeSprint, debt, handoff) |
| [kyro.json](templates/kyro.json) | Global registry: scopes list and activeScope |
| [archive-sprint.md](templates/archive-sprint.md) | Human-readable narrative written when a sprint closes |

Deprecated v3 templates (state.json, index.json, ROADMAP.summary.json, DEBT.summary.json, rules.index.json, events.ndjson) have been moved to [old-to-delete/](templates/old-to-delete/) and must not be used. Run `kyro migrate` to upgrade v3 scopes.

## fixtures/

| File | Description |
|------|-------------|
| [subcommands-and-reports.sizingDecision.json](fixtures/subcommands-and-reports.sizingDecision.json) | Regression fixture proving 3 justified sprints can be valid |
