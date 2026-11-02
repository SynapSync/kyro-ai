---
title: 'sprint-git-traceability — Sprint 2: Opt-in close commit, docs, and release'
date: '2026-11-02'
scope: 'sprint-git-traceability'
sprint: 2
slug: 'opt-in-close-commit'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 2: Opt-in close commit, docs, and release

> Closed: 2026-11-02
> Outcome: shipped

## Objective

A confirmed sprint close can optionally create one commit containing only the files the close wrote, with identical CLI and MCP behavior and structured results, a forward-compatibility advisory per ADR-0001, and documentation plus synchronized 6.5.0 release metadata.

## Definition of Done

- All tasks done with CLI-recorded evidence and a passing verdict.
- Proportional close validation passes; this sprint touches escalate paths (src/cli/state.ts, package.json), so the full integration suite runs at close.
- debt-3, debt-4, debt-5, and debt-6 are resolved through their tasks; the Windows CI job for PR #154 is confirmed or its status is recorded.

## Phases

### P1 — Preference and commit engine

> Validated personal preference and a non-destructive, path-isolated commit engine.

#### T2.1: Add the git.commitOnSprintClose personal preference

**Status**: done

**Description**: Add optional KyroLocalProjectState.git = { commitOnSprintClose?: boolean }, validated when present in validateLocalProjectStateShape (object; boolean when present). Add resolveCommitOnSprintClose() in src/cli/state.ts mirroring resolveDelegationEnabled (true only when explicitly true). Every code path that normalizes or rewrites local.json must preserve a valid git block. Create scripts/check-sprint-close-commit.mjs (temp data under os.tmpdir), register check:sprint-close-commit in package.json (standalone and aggregate chain) and in the close-checkpoints rule of .agents/kyro/validation.json.

**Evidence**:
- Summary: Added local-only preference git.commitOnSprintClose (LocalGitPreferences on KyroLocalProjectState), validated when present (git object; boolean flag), and resolveCommitOnSprintClose() (true only when explicitly true). Fixed preservation across local.json rewrites: sanitizeLocalForWrite never copied execution/git into its cleaned object, mergeProjectLayers/effectiveFromMonolito dropped them from the effective state, and splitMonolitoToLayers rebuilt local.json without them. Personal fields now ride through the effective state and back to local.json (never project.json). This also fixes a pre-existing loss of execution.delegationEnabled on any state rewrite (e.g. scope set-active). check:sprint-close-commit created and registered.
- Validation: npm run check:sprint-close-commit: pass (absent/true/false/empty git validate; non-object git and non-boolean flag rejected with field-specific issues; resolver false when absent or false, true only when true; git block survives scope set-active; execution.delegationEnabled and git survive a second set-active together)
- Validation: Before the sanitizeLocalForWrite fix the survival case failed (local.json rewritten without git); after the fix it passes
- Validation: npm run build, typecheck, check:layered-state, check:install-rehydrate, check:scope-registry-from-disk, check:sprint-loader, check:sprint-doctor-v4, check:update, check:adapters, check:reconcile: pass
- Validation: Read package.json and .agents/kyro/validation.json: check:sprint-close-commit registered as script, in the aggregate chain, and in the close-checkpoints rule
- Files changed: `src/cli/types.ts`, `src/cli/artifacts/schema.ts`, `src/cli/state.ts`, `scripts/check-sprint-close-commit.mjs`, `package.json`, `.agents/kyro/validation.json`
- Notes: Pre-existing bug fixed in passing (same root cause): execution.delegationEnabled was silently dropped whenever Kyro rewrote local.json through the layered state writer.

**Verdict**: pass

---
#### T2.2: Implement the path-isolated close-commit engine

**Status**: done

**Description**: Create src/cli/core/close-commit.ts exporting commitCloseArtifacts({ cwd, paths, scope, sprintN, title }) returning { status: 'committed'|'skipped'|'failed', sha?, reason?, manualCommand? }. Guards return skipped with a reason: not a repository/git unavailable, no commits, detached HEAD, merge/rebase/cherry-pick/revert in progress (rev-parse --git-path MERGE_HEAD, REBASE_HEAD, CHERRY_PICK_HEAD, REVERT_HEAD, rebase-merge, rebase-apply), any close path ignored by git (check-ignore), no close path with changes. Otherwise run git add -- <changed close paths> then git commit --only -F <message> -- <paths>, with message 'chore(kyro): close <scope> sprint <n> — <title>' and a trailer block 'Kyro-Scope: <scope>' / 'Kyro-Sprint: <n>'. Never push, amend, --no-verify, or --no-gpg-sign; honor hooks and signing config. Any git failure returns failed with a short stderr summary and the exact manual command; it never throws.

**Evidence**:
- Summary: Added src/cli/core/close-commit.ts: commitCloseArtifacts() returns committed|skipped|failed and never throws. Guards (skipped with reason): not a repo/git unavailable, no commits, detached HEAD, merge/cherry-pick/revert/rebase/am in progress (rev-parse --git-path markers), untracked close path ignored by git (with manual command), nothing to commit. Otherwise git add -- <changed close paths> then git commit --only -F - -- <paths> with 'chore(kyro): close <scope> sprint <n> — <title>' plus Kyro-Scope/Kyro-Sprint trailers. No push/amend/--no-verify/--no-gpg-sign; hooks and signing config honored; git failures return failed with a stderr summary and an exact manual command.
- Validation: npm run check:sprint-close-commit: pass (S11 commit holds exactly the 4 changed close paths, unchanged project.json excluded, pre-staged src/staged.txt stays staged and uncommitted, unstaged src/app.txt stays unstaged; S12 subject format, interpret-trailers --parse returns Kyro-Scope/Kyro-Sprint, log --grep finds the sha; S14 non-repo, unborn, detached, rebase-merge in progress, ignored archive path, nothing-to-commit all skipped with reasons and HEAD unchanged; S13 rejecting pre-commit hook => failed with hook stderr and manual command, no commit; passing hook runs and commit succeeds)
- Validation: Mutations: dropping --only/pathspec => isolation cases fail (staged.txt committed); disabling the in-progress guard => rebase case fails (commit created); restored => pass
- Validation: npm run build, typecheck, check:git-trackability, check:active-plan, check:status, check:eval: pass
- Files changed: `src/cli/core/close-commit.ts`, `scripts/check-sprint-close-commit.mjs`
- Notes: On a failed commit the changed close paths remain staged by the engine's git add; the manual command completes the commit. Hook tests use #!/bin/sh scripts (Git for Windows runs them via its bundled shell).

**Verdict**: pass

---
### P2 — Close wiring, parity, and compatibility

> Run the commit only after a verified close on both surfaces, expose structured results, and warn mixed-version teams.

#### T2.3: Wire the commit into CLI and MCP close with structured results

**Status**: done

**Description**: Implement one post-close step shared by executeConfirmedClose and the MCP closeSprintTool: after applySprintCloseTransaction and verifyWrittenSprint succeed, and only when resolveCommitOnSprintClose() is true, call commitCloseArtifacts with exactly the close write set (checkpoint, legacy snapshot, narrative, sprint.json, projectScopeWritePath()). Never run on --dry-run or unconfirmed MCP calls. CLI text prints the commit result; CLI --json data and the MCP applied result both carry { git, commit, warnings[] } with the dirty warning as structured text (debt-4). On a resumed close whose checkpoint has no close.git, report 'not recorded at the original close attempt' instead of a present-time reason (debt-5). Add outcome 'preview'/'applied' to plan sprint-mode --json data (debt-6). Add an MCP close assertion for git/commit/warnings.

**Evidence**:
- Summary: Close now returns a PostCloseContext from inside the state-writer lock; a shared finalizeClose() runs after the lock is released (commit hooks may invoke Kyro) for both CLI and MCP: builds the git report ({recorded,branch,endCommit,dirty} or {recorded:false,reason}), structured warnings (dirty), and the opt-in commit via commitCloseArtifacts with exactly the close write set (checkpoint, legacy snapshot, narrative, sprint.json, projectScopeWritePath()) only when resolveCommitOnSprintClose() is true. CLI prints range, warnings, and commit result and sets --json data {scope, sprint, outcome, nextAction, git, commit, warnings}; MCP callTool finalizes after the lock and returns the same git/commit/warnings fields (internal context never leaked). Resumed closes without close.git report 'not recorded at the original close attempt' (debt-5). plan sprint-mode --json data includes outcome preview/applied (debt-6). Structured git/warnings in CLI --json and MCP resolve debt-4.
- Validation: npm run check:sprint-close-commit: pass (preference true: CLI close commits once, findable by Kyro-Sprint trailer, structured git/commit/warnings in --json, no close-written file left uncommitted, text prints 'Close commit:'; preference absent and false: no commit, commit null; --dry-run and unconfirmed MCP close create no commit; confirmed MCP close over the real stdio server commits and matches the CLI git/commit key shapes and committed paths; no internal post-close key leaked)
- Validation: npm run check:sprint-git-traceability: pass (close first attempted outside git, interrupted, resumed after git init prints 'not recorded at the original close attempt'; plan --json data.outcome = applied)
- Validation: Mutation: forcing the preference gate to true in dist => 'preference absent/false creates no commit' fail; restored => pass
- Validation: npm run typecheck, check:mcp, check:cli-envelope, check:cli-verbs, check:close-handoff, check:lossless-checkpoints, check:close-policy-compatibility, check:lifecycle-replay, check:scope-retire, check:plan, check:active-plan: pass
- Files changed: `src/cli/commands/close-sprint.ts`, `src/cli/mcp/handlers.ts`, `src/cli/commands/plan.ts`, `scripts/check-sprint-close-commit.mjs`, `scripts/check-sprint-git-traceability.mjs`
- Notes: Commit runs outside the state-writer lock by design. The close trace (events.ndjson) is not part of the close write set, so it remains a working-tree change after the commit when trace files are tracked.

**Verdict**: pass

---
#### T2.4: Advise mixed-version teams when a close writes close.git (ADR-0001)

**Status**: done

**Description**: When a confirmed close freezes close.git and the shared project state has no team.minPackageVersion or one below the release that introduced close.git (6.5.0), add a warning recommending team.minPackageVersion >= 6.5.0 so older runtimes WARN in kyro doctor; text output and the structured warnings[] of CLI --json and MCP. Never modify project.json. No warning when the policy is already >= 6.5.0 or when close.git was not recorded.

**Evidence**:
- Summary: ADR-0001 advisory in the shared finalizeClose(): when a close recorded close.git and team.minPackageVersion is unset, unparseable, or below CLOSE_GIT_MIN_RUNTIME (6.5.0, one constant next to the advisory), a warning recommends setting team.minPackageVersion >= 6.5.0 so older runtimes WARN in kyro doctor. Appears in CLI text, CLI --json warnings, and MCP warnings; never edits project.json; reuses doctor's compareSemverLike.
- Validation: npm run check:sprint-close-commit: pass (floor unset and 6.4.1 => advisory in --json warnings; 6.5.0 and 6.6.0 => none; text output shows it; MCP confirmed close carries the same advisory; non-repo close without git data => no advisory; team policy unchanged in every case)
- Validation: Mutation: removing the 'no close.git' guard in dist => 'no git data means no advisory' fails; restored => pass
- Validation: npm run build, typecheck, check:close-handoff, check:mcp, check:cli-envelope, check:sprint-git-traceability: pass
- Files changed: `src/cli/commands/close-sprint.ts`, `scripts/check-sprint-close-commit.mjs`
- Notes: Acceptance criterion 2 is verified as 'the advisory never changes team policy in project.json' rather than byte-identical project.json, because the close transaction itself may legitimately rewrite the scope entry there; no advisory code path writes any file.

**Verdict**: pass — [object Object]

---
### P3 — Documentation and release

> Document the git range, preference, commit behavior, guards, and compatibility; ship synchronized 6.5.0 metadata.

#### T2.5: Document sprint git traceability and bump to 6.5.0

**Status**: done

**Description**: Document ledger git ranges, activeSprint.git, close.git, the git.commitOnSprintClose preference, commit content and trailers, every guard and failure result, and the forward-compatibility caveat with team.minPackageVersion guidance (docs/sprint-close-checkpoints.md, docs/cli.md, docs/teams.md, README.md). Add a CHANGELOG 6.5.0 entry. Bump package.json, package-lock.json, and WORKFLOW.yaml to 6.5.0 per the release checklist. Do not publish.

**Evidence**:
- Summary: Documented the sprint git range (activeSprint.git, close.git frozen input, ledger[].git, dirty semantics, omission reasons, no backfill) and the ADR-0001 forward-compatibility caveat in docs/sprint-close-checkpoints.md; the close commit (preference, exact file set, message and trailers, hooks/signing honored, no push/amend/bypass, post-lock timing, committed/skipped/failed table, manualCommand, null when off) and JSON/MCP fields in docs/cli.md plus the 6.5.0 version-table row; the local.json git opt-in and the 6.5.0 team floor guidance in docs/teams.md; a README 6.5.0 line; CHANGELOG [6.5.0] with Added/Changed/Fixed (incl. the delegationEnabled preservation fix). Bumped package.json, package-lock.json (root and packages['']), and WORKFLOW.yaml to 6.5.0 via npm version --no-git-tag-version. Not published.
- Validation: Read the changed docs: git range fields, preference, commit content/trailers, every guard and failure result, and the team.minPackageVersion caveat are present; no doc claims full schema compatibility without the caveat
- Validation: package.json, package-lock.json (version and packages[''].version), WORKFLOW.yaml read 6.5.0; npm run check:versions: pass
- Validation: npm run check:links, check:remediation-release-docs, check:dist, check:cli-bundle-assets: pass
- Validation: npm pack --dry-run lists dist/cli/core/close-commit.js and dist/cli/core/git-capture.js
- Files changed: `docs/sprint-close-checkpoints.md`, `docs/cli.md`, `docs/teams.md`, `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `WORKFLOW.yaml`

**Verdict**: pass

---

## Unfinished work

_None — every task is done with a passing verdict._

## Learnings

- Commit sets must come from what a transaction actually wrote, not from the paths it may touch; verify-only branches never belong in a commit.
- git status paths are repository-relative; any comparison with workspace-relative paths must normalize by rev-parse --show-prefix.
- Commands printed for users must match the target shell; tests that execute them must select the platform shell.
- Orchestrator must delegate implementation to Sol 6.1 and QA to Astra; late adoption in this sprint cost significant tokens.

## Resolved Debt

- **debt-3**: Forward compatibility: checkpoints with close.git fail verification on runtimes older than this release
- **debt-4**: Structured git range and warnings in CLI --json close data and MCP results, with an MCP assertion
- **debt-5**: Resumed close without frozen close.git reports a present-time reason
- **debt-6**: plan sprint-mode --json envelope lacks data.outcome

## Recommendations for Sprint 3

- Before releasing 6.5.0, confirm the Windows CI job for PR #154 (debt-7).
- Fix debt-1 (plan --update-active phase statuses) and debt-2 (root lock not gitignored) in a separate scope.
- Release follow-up outside this repo: kyro-qa-assist v1.1 in skills-registry to use ledger[].git ranges.
