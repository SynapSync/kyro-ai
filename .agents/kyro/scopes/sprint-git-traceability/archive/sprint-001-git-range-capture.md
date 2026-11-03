---
title: 'sprint-git-traceability — Sprint 1: Git range capture in plan and close'
date: '2026-11-02'
scope: 'sprint-git-traceability'
sprint: 1
slug: 'git-range-capture'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 1: Git range capture in plan and close

> Closed: 2026-11-02
> Outcome: shipped

## Objective

Every sprint planned and closed with this version records a deterministic, checkpoint-verifiable git range (branch, start commit, end commit, dirty flag) in the scope ledger, while every existing scope and checkpoint keeps validating and re-deriving unchanged.

## Definition of Done

- All tasks done with CLI-recorded evidence and a passing verdict.
- Proportional close validation passes; this sprint touches escalate paths (src/cli/artifacts/**, src/cli/checkpoints/**), so the full integration suite runs at close.
- No existing scope or checkpoint in the repository changes validation, verification, or re-derivation results.

## Phases

### P1 — Data contract and read-only git capture

> Define the optional git blocks with validation and a non-throwing read-only git capture helper.

#### T1.1: Add optional git blocks to the sprint, close-input, and ledger contracts

**Status**: done

**Description**: Add optional typed blocks: ActiveSprint.git { branch: string | null, startCommit: string }, SprintCloseInputs.git { branch: string | null, endCommit: string, dirty: boolean }, LedgerEntry.git { branch: string | null, startCommit: string | null, endCommit: string, dirty: boolean }. Validate each only when present in validateActiveSprint, validateLedgerEntry, and the checkpoint frozen-close-input check (sprint-close.ts ~383): commits are 40- or 64-char lowercase hex, branch is a non-empty string or null, dirty is boolean. Create scripts/check-sprint-git-traceability.mjs (temp data under ~/.cache/kyro-tmp or os.tmpdir) with contract cases, add npm script check:sprint-git-traceability, include it in the aggregate npm run check, and add it to the checkpoints rule in .agents/kyro/validation.json.

**Evidence**:
- Summary: Added optional git blocks: ActiveSprint.git {branch,startCommit}, SprintCloseInputs.git {branch,endCommit,dirty}, LedgerEntry.git {branch,startCommit|null,endCommit,dirty}. Shared validateGitBlock (schema.ts) validates each only when present (40/64 lowercase hex commits, non-empty branch or null, boolean dirty) from validateActiveSprint, validateLedgerEntry, and checkpointSchemaIssues for close.git. New check script registered in package.json (standalone + aggregate chain) and the close-checkpoints rule of validation.json.
- Validation: npm run check:sprint-git-traceability: pass (valid start/end/ledger blocks accepted; short, uppercase, non-hex commits, empty/missing branch, non-boolean/missing dirty, non-object rejected with field-specific issues; legacy close without git adds no schema issue; 13 repo scopes and 28 checkpoints have no git issues)
- Validation: npm run build: pass; npm run typecheck: pass
- Validation: npm run check:sprint-loader: pass; npm run check:sprint-doctor-v4: pass
- Validation: npm run check:lossless-checkpoints, check:close-handoff, check:close-policy-compatibility, check:scope-retire, check:lifecycle-replay: pass
- Validation: npm run check:layered-state, check:scope-registry-from-disk, check:install-rehydrate, check:versions, check:remediation-release-docs: pass
- Validation: Read package.json and .agents/kyro/validation.json: check:sprint-git-traceability present as script, in aggregate check chain, and in close-checkpoints rule
- Files changed: `src/cli/types.ts`, `src/cli/artifacts/schema.ts`, `src/cli/checkpoints/sprint-close.ts`, `scripts/check-sprint-git-traceability.mjs`, `package.json`, `.agents/kyro/validation.json`
- Notes: close.git is validated in checkpointSchemaIssues, not checkpointIntegrityIssues, so historical-evidence commitment logic is untouched; adding close.git to an already-written checkpoint is correctly treated as tampering by the existing digest.

**Verdict**: pass — [object Object]

---
#### T1.2: Implement a non-throwing read-only git capture helper

**Status**: done

**Description**: Create src/cli/core/git-capture.ts exporting functions that, for a given cwd, return the HEAD commit and branch (null when detached), or null when not a repository, git is missing, HEAD is unborn, or any git call fails; and report whether tracked or untracked non-ignored files outside .agents/kyro/ have uncommitted changes. Use execFileSync('git', [...args]) with array arguments and no shell, as in src/cli/core/git-trackability.ts. The helper performs no writes and never throws.

**Evidence**:
- Summary: Added src/cli/core/git-capture.ts: readGitHead (HEAD commit + branch, null branch when detached), hasUncommittedChangesOutsideKyro (porcelain -z, untracked included, ignored excluded, excludes the workspace's own .agents/kyro/ using rev-parse --show-prefix), captureSprintGitStart and captureSprintGitEnd. execFileSync with array args, no shell, 10s timeout; every function returns null instead of throwing (non-repo, missing git, unborn HEAD, any failure).
- Validation: npm run check:sprint-git-traceability: pass (temp repos: normal branch returns main + rev-parse HEAD; detached returns branch null; non-repo and unborn HEAD return null; missing cwd returns null without throwing; only .agents/kyro/ or ignored changes => dirty false; modified tracked and untracked non-ignored file => dirty true; subdirectory workspace excludes only its own .agents/kyro/)
- Validation: Mutation: KYRO_DIR changed in dist => check fails on the two exclusion cases; restored => pass
- Validation: npm run build, typecheck, check:git-trackability: pass
- Validation: npm run check:active-plan, check:status, check:analyze-metadata, check:close-handoff, check:eval (src/cli/core/** rule): pass
- Files changed: `src/cli/core/git-capture.ts`, `scripts/check-sprint-git-traceability.mjs`
- Notes: Test repos isolate global config: -c commit.gpgsign=false, empty core.hooksPath directory, fixed user identity. Capture uses --no-renames so -z entries stay one path each.

**Verdict**: pass — [object Object]

---
### P2 — Capture at plan and close

> Record the start commit when a sprint is planned and freeze the end commit in the close checkpoint inputs, deriving the ledger range deterministically.

#### T1.3: Record the start commit when a sprint is planned

**Status**: done

**Description**: In buildPlanSprintPlan, after building activeSprint, attach activeSprint.git = { branch, startCommit } from the capture helper when available; omit the block otherwise. Planning must never fail because of git. Init mode (activeSprint: null) is unchanged.

**Evidence**:
- Summary: buildPlanSprintPlan attaches activeSprint.git = { branch, startCommit } from captureSprintGitStart() after deriving status; the block is omitted when capture returns null (non-repo, unborn HEAD, git failure). Init mode is unchanged (activeSprint stays null).
- Validation: npm run check:sprint-git-traceability: pass (real kyro plan init + sprint mode in a temp git repo records branch main and startCommit == git rev-parse HEAD, and the planned sprint validates; the same flow in a non-repository workspace succeeds with no git block)
- Validation: npm run build: pass
- Validation: npm run check:plan, check:active-plan, check:emergent, check:scenario, check:clarify, check:spec-traceability: pass
- Files changed: `src/cli/commands/plan.ts`, `scripts/check-sprint-git-traceability.mjs`
- Notes: Existing check-plan sandboxes live in tmpdir outside any repository, so their expected sprint.json shapes are unaffected.

**Verdict**: pass

---
#### T1.4: Freeze the end commit in close inputs and derive the ledger range

**Status**: done

**Description**: In buildClosePlan's fresh path, capture { branch, endCommit, dirty } before any write and set it as close.git when available. retryCloseInputs must copy checkpoint.close.git verbatim so assertMatchingCloseInputs keeps matching. deriveSprintCloseTransitionWithPolicy adds ledger git = { branch: close.git.branch, startCommit: beforeClose.activeSprint.git?.startCommit ?? null, endCommit, dirty } only when close.git exists. Render a 'Git' section in the archive narrative when present. When dirty is true, the CLI close prints a warning that uncommitted changes are outside the sprint range, and the MCP close result exposes the captured git data.

**Evidence**:
- Summary: buildClosePlan fresh path freezes captureSprintGitEnd() as close.git before any write; retryCloseInputs copies checkpoint.close.git so retries never re-read HEAD; deriveSprintCloseTransitionWithPolicy adds ledger.git {branch, startCommit from beforeClose.activeSprint.git or null, endCommit, dirty} only when close.git exists. Narrative gets a 'Git range' section; CLI prints the range (or 'not recorded') and a dirty warning; MCP applied result exposes git. Fix found here: the state-writer lock directory at the workspace root is held during close and is not gitignored at root, so every close read dirty=true; hasUncommittedChangesOutsideKyro (T1.2 file) now also excludes STATE_WRITER_LOCK (exported from state-writer-lock.ts).
- Validation: npm run check:sprint-git-traceability: pass (S3 real close in temp repo: ledger git = main, planned startCommit, endCommit = HEAD before close, dirty false; checkpoint re-derives with zero integrity issues; narrative has the range. S4 close interrupted via KYRO_TEST_CLOSE_FAIL_AFTER=checkpoint, new commit, retry succeeds without CHECKPOINT_CONFLICT and keeps original endCommit. S6 uncommitted tracked change => dirty true + warning. Sprint planned without git then closed in a repo => startCommit null. S5 non-repo close => no ledger git, 'Git range: not recorded'. S7 all 28 repo checkpoints still re-derive with zero integrity issues)
- Validation: Mutation: retry endCommit altered in dist => check fails with CHECKPOINT_CONFLICT on the retry case; restored => pass
- Validation: npm run build, typecheck: pass
- Validation: npm run check:lossless-checkpoints, check:close-handoff, check:close-policy-compatibility, check:scope-retire, check:lifecycle-replay, check:replay-witness: pass
- Validation: npm run check:mcp, check:operation-snapshots, check:active-plan, check:status, check:analyze-metadata, check:eval, check:git-trackability: pass
- Files changed: `src/cli/commands/close-sprint.ts`, `src/cli/checkpoints/sprint-close.ts`, `src/cli/mcp/handlers.ts`, `src/cli/core/git-capture.ts`, `src/cli/pipeline/state-writer-lock.ts`, `scripts/check-sprint-git-traceability.mjs`
- Notes: git-capture.ts belongs to T1.2 (already passed); its dirty exclusion was corrected here with a new capture case for the lock directory. MCP git field is covered only by build/typecheck and check:mcp regression, not a dedicated MCP close assertion; Sprint 2 parity work (R12) adds it. Pre-existing: the root-level .kyro-state-writer.lock/ is not gitignored (the entry lives in .agents/kyro/.gitignore), so a git add -A during a write could stage it.

**Verdict**: pass — [object Object]; [object Object]

---
### P3 — Preservation across writers

> Prove that no command that rewrites the active sprint or ledger drops the git blocks.

#### T1.5: Audit active-sprint and ledger writers and add preservation tests

**Status**: done

**Description**: Audit every writer of activeSprint or ledger entries (active-plan update, record-evidence, review, add-emergent, scenario, clarify, debt, rule, repair integrity, remediation and certification plans, scope complete/reopen/retire, lifecycle state, legacy migration, Work promotion). Fix any that rebuild objects field-by-field and would drop git. Add preservation cases for the highest-traffic writers to the check script and record the audit outcome per writer in the task evidence.

**Evidence**:
- Summary: Audited every activeSprint/ledger writer; none drops the git blocks, so no source change was needed. Preservation is now proven by tests on the highest-traffic writers.
- Validation: npm run check:sprint-git-traceability: pass (activeSprint.git byte-identical after plan --update-active, record-evidence, review, and repair --yes; ledger[0].git byte-identical after scope complete and scope reopen; ledger carries the planned startCommit)
- Validation: npm run build, check:active-plan, check:record-evidence, check:repair-integrity, check:maker-checker, check:scope-remediation, check:verification-states: pass
- Validation: Audit outcomes — preserves: core/active-plan.ts (deep clone + in-place status), commands/record-evidence.ts, review.ts, add-emergent.ts (JSON deep clone of activeSprint), commands/scenario.ts (spread ...active), commands/repair.ts (deep clone, sets statuses only), artifacts/schema.ts asSprintFile (validate + cast, no stripping), remediation/plan.ts ledger.checkpoint.reanchor (in-place field update), checkpoints/sprint-close.ts (ledger appended, prior entries copied by reference), scope-completion/scope-reopen (top-level spread; verified by test). Not applicable: scope-retirement (sets activeSprint null only when no active sprint), migrations/legacy-sprints (pre-v4 inputs carry no git). Captures: work/promotion.ts reuses buildPlanSprintPlan, so promoted sprints also record startCommit.
- Files changed: `scripts/check-sprint-git-traceability.mjs`
- Notes: files_to_touch listed likely edit points; the audit found none that needed edits.

**Verdict**: pass

---

## Unfinished work

_None — every task is done with a passing verdict._

## Learnings

- Freezing captured environment data in checkpoint inputs is what keeps re-derivation and retries deterministic; data added outside the frozen inputs breaks verification.
- The state-writer lock lives at the workspace root and is held during close; any git-based check of the working tree must exclude it (and its reclaim leftovers).
- git status refreshes .git/index unless run with --no-optional-locks; read-only capture must pass it.
- Independent QA found a requirement wording gap (R4 'user is informed' on plan) and a forward-compatibility break that task-level review missed.

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 2

- Sprint 2: decide debt-3 (forward compatibility with older runtimes) before release; the decision shapes docs and CHANGELOG.
- Sprint 2: confirm the Windows CI job passes check:sprint-git-traceability on the first push.
- Sprint 2: fold debt-4, debt-5, debt-6 into the R12 parity and output work.
- Sprint 2: link new tasks to scenarios at planning time so emergent work does not ship without scenario_refs.
