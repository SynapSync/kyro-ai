# Kyro Cost Optimization Audit

This audit records the token-cost issues found before the lean runtime refactor.

## Findings

| Finding | Impact | Fix |
|---------|--------|-----|
| Eager orchestrator instructions were large | Every Kyro invocation could pay for full lifecycle context | Slim orchestrator and move details to lazy protocols |
| `sprint-forge/SKILL.md` mixed runtime and human docs | Skill loading could include quickstart/architecture content | Keep runtime contract only; move cost explanation to docs |
| SPRINT loading referenced planning/debt/re-entry helpers too early | Execute/status paths could load unrelated heavy helpers | Route to exactly one mode and only named helpers |
| Token audit measured simplified paths | False confidence in startup cost | Add realistic runtime path budgets |
| Task execution encouraged repeated artifact rewrites | High output/input churn | Record compact evidence directly on the task object in `sprint.json` during execution and write the archive snapshot only at close |
| Conventions loaded as full Markdown | Growing rules ledger would increase startup cost | Fold conventions and debt into fields on `sprint.json` |

## Baseline Facts

Before slimming, the largest eager files were approximately:

- `agents/orchestrator.md`: 1,975 words
- `skills/sprint-forge/SKILL.md`: 1,803 words
- `sprint-generator.md`: 885 words
- `debt-tracker.md`: 787 words
- `reentry-generator.md`: 634 words

After the refactor, `doctor --tokens` enforces runtime budgets for each Kyro path.
