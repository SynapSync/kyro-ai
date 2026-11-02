# 05 — Capture startCommit when a sprint is planned

- **Severity:** medium
- **Affected:** `src/cli/commands/plan.ts` (`buildPlanSprintPlan` :449-485; init mode leaves `activeSprint: null` :398), `src/cli/types.ts` (`ActiveSprint` :554), `src/cli/artifacts/schema.ts` (`validateActiveSprint` :804)
- **Behavior:** every sprint, including sprint 1, is materialized by sprint mode; no commit is recorded today.
- **Recommendation:** add optional `activeSprint.git = { branch, startCommit }` captured read-only via `execFileSync('git', [...])` (pattern of `src/cli/core/git-trackability.ts`); omit on non-repo/unborn HEAD; never block planning.
- **Validation:** planned sprint in temp repo records HEAD; non-repo plan succeeds without the block.
