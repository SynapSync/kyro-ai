---
description: Governs task estimation practices including rule loading, historical calibration, buffer allocation, and error tracking for continuous improvement.
globs: ["**/*.md"]
alwaysApply: true
---

# Estimation

Rules governing how tasks are estimated and how estimation accuracy is tracked over time.

## R-ES-01: Load Estimation Rules Before Estimating

Load estimation rules from `.agents/sprint-forge/rules.md` before producing any estimate.

- Filter for rules tagged with estimation-related keywords (estimate, duration, complexity, underestimate).
- Apply relevant corrections to the base estimate.
- If the rules file is unavailable, proceed with base estimates but flag the sprint as "uncalibrated."

## R-ES-02: Buffer for Historically Underestimated Types

Add buffer for task types that have been historically underestimated.

Common underestimation patterns:
- **Migration tasks**: Add 30% buffer (data edge cases, rollback planning)
- **Integration tasks**: Add 25% buffer (API mismatches, auth flows)
- **Refactoring tasks**: Add 20% buffer (hidden dependencies, test updates)
- **First-time frameworks**: Add 40% buffer (learning curve, configuration)

These defaults are overridden by project-specific learned rules when available.

## R-ES-03: Track Actual vs Estimated

Track actual completion time against estimates for every task.

- Record in the sprint file: `estimated: Xh | actual: Yh | delta: ±Z%`
- Deltas are inputs to the retro's estimation accuracy analysis.
- The `kyro-metrics` skill aggregates these across sprints for trend detection.

## R-ES-04: Flag Significant Estimation Errors

Flag tasks with greater than 30% estimation error in the retrospective.

- Over-estimates (>30% faster than expected) suggest the task was simpler than anticipated or the estimator is being too conservative.
- Under-estimates (>30% slower than expected) suggest hidden complexity or scope creep.
- For each flagged task, record:
  - Root cause of the error
  - Whether a learned rule should be created
  - Adjusted buffer for similar future tasks

## R-ES-05: Estimation Units

Use consistent estimation units across all sprints.

- Unit: story points mapped to approximate hours (1 SP = ~1h for a senior developer).
- Range: 1-8 SP per task. Tasks estimated above 8 SP must be decomposed.
- If the user prefers different units, calibrate once and record the mapping in the project's sprint config.
