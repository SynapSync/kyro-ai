# Validation Protocol (Forge)

Blockers and warnings follow the orchestrator gates and `../helpers/reviewer.md`. Keep commands bounded.

## Task tier

- Focused by default: `validation.task` plus your focused checks for `validation.uncoveredFiles` (no rule ≠ validated); no map → narrowest checks for changed files.
- Broaden, up to the aggregate, for cross-cutting changes (shared types, build/packaging, install, wiring); give the reason in `record-evidence --notes`. Avoid redundant aggregate runs.
- Live criteria win: satisfy each criterion in force (reuse valid evidence first) or correct/waive it via `plan --update-active` / `review --waive-criterion`; never skip it.
- Expensive proofs (mutation, byte-identical, package/install) only when the contract requires them or `context` says `High risk:`.

## Evidence reuse

Reuse maker evidence only with command, passing result and a verifiable tested-state reference — a clean revision captured at test time (`git rev-parse HEAD`, empty `git status --porcelain`) matching the current state, or the same session with verifiable absence of relevant changes (other agents included). `mtime` and `reviewedMaterialDigest` (task metadata, not source) are not proof. Otherwise rerun the affected focused checks.

## Close tier

Proportional to the sprint's change, not the aggregate by default: follow `close-validation.md` at QA-or-close/close.
