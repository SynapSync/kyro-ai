# Kyro Work CLI

Kyro Work is an explicit, isolated workflow for plans that need durable tasks, dependencies, evidence, and task review. Kyro does not choose Work or Forge based on plan size. Work task review applies to one task; it does not certify a scope or replace Forge QA.

On a supported host, invoke Work explicitly through its projected skill (Claude `/kyro-work`, Codex or standard `kyro-work`) or OpenCode's native `/kyro/work` command. The router checks CLI capabilities and requests fresh `work status` and `work context-pack` before any continuation. It never selects Work automatically or changes the Forge, Idea, QA, status, or install routes. The host entry point is a guide to the same `kyro work` CLI, not a separate state writer.

## Build and verify the command

Check the active CLI before using Work:

```bash
kyro --version
kyro capabilities --json
```

When developing Work in this checkout, build and invoke the workspace CLI so its command surface matches the source:

```bash
npm run build
node dist/cli.js work --help
```

An installed runtime may not yet expose the Work command. Do not assume a workspace build updated the global runtime; install or update it through the separately authorized release workflow.

## Create a Work and plan tasks

Write a concise Markdown brief that states the intended outcome, then create the Work through the CLI:

```bash
node dist/cli.js work create --id search-refresh --from brief.md --json
```

The create source policy is bounded, no-follow, and lossless: the CLI opens one regular file without following symbolic links, checks the opened descriptor, reads at most 1 MiB plus one rejection byte, and fails closed when the source is replaced, grows, or is modified mid-read. Sources decode as strict UTF-8 and must round-trip exactly, so malformed bytes are rejected instead of stored as U+FFFD. Valid Unicode, a UTF-8 BOM, and CRLF line endings publish byte-for-byte, and `brief.digest` is the SHA-256 of the original source bytes while title and objective extraction never alters the published bytes. A rejected source publishes no Work directory and leaves Forge `project.json`, `local.json`, and every `sprint.json` untouched.

Plan input is a JSON object containing only a `tasks` array. IDs follow proposal order as `W1` through `Wn`. Each task has exactly `id`, `title`, `description`, `context`, `filesToTouch`, `acceptanceCriteria`, and `dependsOn`.

```json
{
  "tasks": [
    {
      "id": "W1",
      "title": "Build the parser",
      "description": "Parse the supported query form and report invalid input.",
      "context": "Keep the parser independent from the CLI adapter.",
      "filesToTouch": ["src/search/parser.ts"],
      "acceptanceCriteria": ["Valid queries produce the documented syntax tree."],
      "dependsOn": []
    },
    {
      "id": "W2",
      "title": "Add the CLI adapter",
      "description": "Expose the parser through the command line.",
      "context": "",
      "filesToTouch": ["src/cli/search.ts"],
      "acceptanceCriteria": ["The CLI reports parse errors with a nonzero exit."],
      "dependsOn": ["W1"]
    }
  ]
}
```

Preview first, then apply against the revision returned by status or context-pack:

```bash
node dist/cli.js work plan --work search-refresh --from tasks.json --expect-revision 1 --dry-run --json
node dist/cli.js work plan --work search-refresh --from tasks.json --expect-revision 1 --json
```

The CLI validates exact fields, unique criteria, safe relative paths, existing dependencies, and cycles before one atomic revision update. Cycle detection is iterative. The proposal file has a 16 MiB operational input limit to bound one CLI invocation; there is no conceptual task-count or difficulty policy. The preview does not write Work state.

## Execute and block tasks

Refresh the current handoff before every mutation. A task can start only after every prerequisite is verified:

```bash
node dist/cli.js work status --work search-refresh --json
node dist/cli.js work context-pack --work search-refresh --json
node dist/cli.js work start --work search-refresh --task W1 --expect-revision 2 --json
```

If work cannot proceed, record a reason. Unblocking returns the task to pending; eligibility is derived again from its prerequisites. Independent eligible tasks remain available while another task is blocked.

```bash
node dist/cli.js work block --work search-refresh --task W1 --reason "Waiting for the service contract." --expect-revision 3 --json
node dist/cli.js work unblock --work search-refresh --task W1 --expect-revision 4 --json
```

All mutations require the current `--expect-revision`. A conflict means another write won; refresh status/context-pack and retry from the new revision.

Status and context-pack report `eligible` only when a pending task can be started. Context-pack recipes follow the selected task state and current revision; an in-progress task receives an evidence recipe, an awaiting-review task receives a review recipe, and a blocked task receives an unblock recipe. A brief-integrity anomaly suppresses mutation recipes until the discrepancy is resolved.

## Record evidence

Evidence input is bounded JSON with exactly `summary`, `validations`, `filesChanged`, and `notes`. Each validation has exactly `command`, `result` (`passed`, `failed`, or `not_run`), and `note`. Keep notes concise and omit transcripts, secrets, and raw tool output. The maker must supply a specific `--by` identity. The CLI stamps that identity and time and computes the material digest from the current brief and task definition. Validation results are maker-reported claims: this command does not run or authenticate the listed commands.

```json
{
  "summary": "Implemented parsing and exercised valid and invalid inputs.",
  "validations": [
    { "command": "npm run check:search-parser", "result": "passed", "note": null }
  ],
  "filesChanged": ["src/search/parser.ts"],
  "notes": null
}
```

```bash
node dist/cli.js work record-evidence --work search-refresh --task W1 --from evidence.json --by maker-id --expect-revision 3 --json
```

Only an in-progress task with verified prerequisites can receive evidence. Failed and unrun validations remain visible and block a pass review.

## Review task evidence

Review input has exactly `checkedCriteria` and `findings`. List every current acceptance criterion exactly once before a pass. Each finding has `severity` (`critical`, `warning`, or `suggestion`) and a nonempty `detail`.

```json
{
  "checkedCriteria": ["Valid queries produce the documented syntax tree."],
  "findings": []
}
```

```bash
node dist/cli.js work review --work search-refresh --task W1 --from review.json --verdict pass --by checker-id --expect-revision 4 --json
```

A pass requires current evidence and material digests, exact criterion coverage, all recorded validations marked passed, no critical finding, and a checker identity different from the maker identity. The checker must independently inspect the actual results and criterion sufficiency; the CLI cannot prove that a reported command ran or that a criterion was met. A fail verdict requires a finding and returns the task to in-progress; record fresh evidence before another review. A failed task may be blocked and later resumed in-progress without discarding its finding. After a pass, dependent tasks become eligible on the next derived handoff. This is a task-level checker attestation, not independent Kyro QA or automatic test certification.

## Scope boundaries

Amend a task only with the six exact definition fields (the same task fields as a plan, excluding `id`). A changed definition increments `definitionRevision` and invalidates its prior approval and affected dependents; a stale review cannot be replayed:

```bash
node dist/cli.js work amend-task --work search-refresh --task W1 --from amended-task.json --reason "Clarify parser diagnostics." --by maintainer-id --expect-revision 5 --dry-run --json
node dist/cli.js work amend-task --work search-refresh --task W1 --from amended-task.json --reason "Clarify parser diagnostics." --by maintainer-id --expect-revision 5 --json
```

Brief amendments require a valid UTF-8 source whose bytes round-trip exactly. The CLI opens one regular file without following symbolic links, bounds descriptor reads to 1 MiB plus one rejection byte, and publishes the original bytes without changing line endings. If the platform cannot enforce no-follow opening, the command refuses the source. `--dry-run` never writes. A durable, local pending-amendment record protects interrupted publication. While that record exists, status reports a blocker and other Work mutations are refused. Retry `amend-brief` with the same source, actor, reason, and expected revision to finish a matching interrupted write; a corrupt record or externally changed file fails closed. The record is removed after successful publication and is ignored by Git. Never edit `brief.md`, `work.json`, or the pending record by hand.

```bash
node dist/cli.js work amend-brief --work search-refresh --from revised-brief.md --reason "Correct the target outcome." --by maintainer-id --expect-revision 6 --dry-run --json
node dist/cli.js work amend-brief --work search-refresh --from revised-brief.md --reason "Correct the target outcome." --by maintainer-id --expect-revision 6 --json
```

The CLI invalidates affected task approvals. Evidence validation entries remain maker-reported; the CLI does not execute their commands. A separate checker must inspect the actual work before a new pass.

Use `kyro work dispose --work <id> --task Wn --kind cancelled|superseded --reason <text> --by <actor> --expect-revision <n>` to stop a task explicitly. Superseded tasks also require `--replacement-task Wn`; cancelled tasks cannot name a replacement. Preview with `--dry-run` before applying. Disposal is not verification: a failed review may remain attached for history, and dependencies on the disposed task remain unchanged and ineligible until an explicit task amendment removes them. A replacement cannot depend, directly or transitively, on the task it replaces.

Close Work with `kyro work close --work <id> --outcome completed|stopped --reason <text> --by <actor> --expect-revision <n>`. First use `--dry-run` to see verified, disposed, and every unresolved task; then repeat with `--yes` to confirm. `completed` requires every task to be verified or explicitly disposed. `stopped` can retain unfinished work, but its summary enumerates it and never calls the outcome completed. An empty draft can also be stopped directly, which records an intentional discard without inventing tasks; it cannot be completed. Closure records the current brief digest and final revision; it does not close a Forge sprint or certify Forge QA.

Reopen only a closed Work with `kyro work reopen --work <id> --reason <text> --by <actor> --expect-revision <n>`, again previewing with `--dry-run` before `--yes`. A stopped empty draft reopens as `draft` (rather than an invalid taskless `active` Work); planned Work reopens as `active`. The CLI writes a versioned `closure-history/closure-r<n>.json` record before clearing the current closure and records `work_reopened` activity. A retry after history publication is safe only when the immutable record matches the current closure. Promoted Work cannot reopen. Both commands reject a changed brief and stale revision.

## Promote a Work to Forge

Promotion is explicit, reciprocal, and recoverable. It requires the unfinished Work ID, a fresh Forge scope slug chosen by the user, the current Work revision, and an explicit actor. Preview the exact translation before any confirmation:

```bash
node dist/cli.js work promote --work search-refresh --to-scope search-forge --expect-revision 9 --by maintainer-id --dry-run --json
```

The read-only preview discloses every transferred task with its deterministic `Wn` to `T1.n` mapping, preserved dependencies, omitted verified and disposed history, explicit adjudication of dependencies on verified source work, approval reset (every Forge task starts pending with no evidence or verdict), and the exact reciprocal source and target identities plus the canonical request digest. Work verdicts never become Forge passes or QA. The preview rejects a pre-existing target, unsafe slug, stale revision, missing actor, blocked source task, disposed prerequisite, missing or changed brief, corrupt source, or a Work with no transferable unfinished tasks without writing either workflow.

Confirm in a separate command:

```bash
node dist/cli.js work promote --work search-refresh --to-scope search-forge --expect-revision 9 --by maintainer-id --yes --json
```

The apply runs as one CLI-owned transaction: it records a durable pending intent, stages `sprint.json`, the reciprocal `promotion-source.json` link, and an immutable `promotion-initial-sprint.json` copy under a hidden Work-local directory, publishes the final Work revision, and atomically renames the complete directory into the new Forge scope. It verifies the initial snapshot digest and reciprocal identities, then clears the intent. A visible Forge scope is never missing its promotion link because the directory is published in one rename. The ordinary `plan` path is never invoked as a side effect, so the active scope is untouched and unrelated Forge scopes, `project.json`, and `local.json` stay byte-identical. A stopped Work keeps its historical closure metadata; a promoted Work cannot reopen or promote again.

An interrupted promotion is a blocker, not a success: `work status` and `work context-pack` report `resolve_blocker` with the exact retry command, and every other Work mutation is refused until recovery. Retry the identical command (same target, actor, and revision) to complete it; any conflicting retry, corrupt intent, changed brief, edited Work, target collision, or staged/published target tampering fails closed. The pending intent and staging scratch are ignored by Git, while the final `work.json`, reciprocal link, and initial sprint copy stay trackable. `doctor --artifacts` verifies the initial promotion provenance and the current Forge sprint's schema and scope identity. Normal Forge CLI progress may change the live `sprint.json` without invalidating the initial digest. This check does not prove that every later Forge edit was CLI-authored; Forge's own integrity and review flow govern its live state.

Work review versus Forge QA: a Work pass attests one task against its current criteria. Promotion carries no approval into Forge, and the new scope still requires the separate Forge workflow with its independent QA before any certification claim. Use the Forge workflow and `/kyro:qa` when scope certification is required.

Runtime boundary: an installed global runtime may not yet expose `work` or `work promote` (check `capabilities --json`). Until a separately authorized release updates it, run promotion from the workspace build (`node dist/cli.js`) and never assume a workspace build updated the global runtime.
