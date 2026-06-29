# Kyro — Assets

Kyro assets are designed for progressive disclosure: load the router first, then only the mode/helper/template needed for the current action.

## modes/

| File | Description |
|------|-------------|
| [INIT.md](modes/INIT.md) | Scope analysis, sprint sizing, and `sprint.json` bootstrap |
| [SPRINT.md](modes/SPRINT.md) | Router on `handoff.nextAction` |
| [plan-sprint.md](modes/plan-sprint.md) | Generate the next sprint into `activeSprint` |
| [execute-task.md](modes/execute-task.md) | Execute active sprint tasks, record evidence |
| [review-task.md](modes/review-task.md) | Validate task quality, record verdict |
| [close-sprint.md](modes/close-sprint.md) | Snapshot, ledger entry, retro, debt, conventions |
| [recover.md](modes/recover.md) | Rebuild `sprint.json` from archive snapshots |
| [STATUS.md](modes/STATUS.md) | Progress report from `sprint.json` |

## helpers/

| File | Description |
|------|-------------|
| [analysis/feature.md](helpers/analysis/feature.md) | Feature analysis and sizing signals |
| [analysis/bugfix.md](helpers/analysis/bugfix.md) | Bugfix analysis and sizing signals |
| [analysis/audit.md](helpers/analysis/audit.md) | Audit analysis and sizing signals |
| [analysis/refactor.md](helpers/analysis/refactor.md) | Refactor analysis and sizing signals |
| [analysis/new-project.md](helpers/analysis/new-project.md) | New project analysis and sizing signals |
| [analysis/tech-debt.md](helpers/analysis/tech-debt.md) | Tech debt analysis and sizing signals |
| [sprint-generator.md](helpers/sprint-generator.md) | Builds the `activeSprint` object |
| [debt-tracker.md](helpers/debt-tracker.md) | Accumulated debt rules (`sprint.json.debt[]`) |
| [learner.md](helpers/learner.md) | Learned rules into `sprint.json.conventions[]` |
| [analyzer.md](helpers/analyzer.md) | Scope analysis support |
| [metrics.md](helpers/metrics.md) | Velocity & debt analytics from `sprint.json` |
| [reviewer.md](helpers/reviewer.md) | Review classification |
| [handoff.md](helpers/handoff.md) | Resume context in `sprint.json.handoff` |

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
