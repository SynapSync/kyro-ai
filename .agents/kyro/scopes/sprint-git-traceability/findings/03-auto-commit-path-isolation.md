# 03 — Auto-commit must include only close-written paths

- **Severity:** high
- **Affected:** `src/cli/checkpoints/sprint-close.ts:508` (close write set: checkpoint, legacy snapshot, narrative, sprint.json, `projectScopeWritePath()`), new git helper, `src/cli/commands/close-sprint.ts` `executeConfirmedClose`, `src/cli/mcp/handlers.ts` `closeSprintTool`
- **Behavior:** `git commit --only -- <paths>` preserves other index entries but rejects paths unknown to git; new archive files are untracked.
- **Recommendation:** after apply + `verifyWrittenSprint`, filter the write set to paths with changes, `git add -- <paths>`, then `git commit --only -m <msg with Kyro-Scope/Kyro-Sprint trailers> -- <paths>`; never push, `--no-verify`, `--no-gpg-sign`, `--amend`; guards for detached HEAD, in-progress operations, unborn HEAD, non-repo, ignored Kyro state; failure never rolls back the close.
- **Validation:** temp repos covering every guard row, a pre-staged unrelated file, a rejecting pre-commit hook.
