# Validation tiers

Kyro separates **task**, **sprint close** and **integration** validation so agents neither rerun a project's
aggregate suite after every task nor pay it as a fixed cost on every sprint. The agent-facing policy lives in
`internal/skills/sprint-forge/assets/protocols/validation.md` and `close-validation.md` (Forge, its delegates and the standalone executor); Work carries an equivalent task rule in its own skill with Work commands (`work amend-task`/`work amend-brief`, evidence `notes`) and, having no pack suggestions, picks focused checks from task criteria and files. Work does **not** use proportional close validation yet: it still runs the project's aggregate check once before close. This page documents the policy for humans.

| Tier | When | What runs |
|------|------|-----------|
| task | `execute_task` / `review_task` | Focused checks: `context-pack --task` → `validation.task`, plus focused checks for `validation.uncoveredFiles` |
| close | `qa_or_close` / `close_sprint` | Proportional to the sprint's change: scope pack → `validation.sprint` (plus `integration` when escalated) |
| integration | integration boundary (e.g. CI before merging) | The aggregate suite: `integration`, declared at `integrationBoundary` |

## Policy

- **Focused by default.** Broaden, up to the aggregate suite, when a task changes cross-cutting contracts
  (shared types, build/packaging, install, wiring) and state the reason in `record-evidence --notes`.
  Avoid redundant aggregate runs.
- **Live criteria win.** `kyro review` checks every criterion. A criterion in force is satisfied (reusing
  valid evidence first) or corrected/waived through the authorized flow (`plan --update-active`,
  `review --waive-criterion`); it is never silently skipped. Planners therefore name close validation in the
  sprint `definitionOfDone` and keep the aggregate suite out of task criteria unless the task is cross-cutting.
- **Expensive proofs** (mutation/revert, byte-identical history, package/install) run when the criteria or
  the contract under change require them, or when the task `context` starts with `High risk:`.
- **Evidence reuse.** A checker reuses maker evidence only when it records the command, a passing result
  and a verifiable reference to the tested state (a clean revision captured at test time that matches the
  current state, or the same session with verifiable absence of relevant changes, including other agents),
  and the relevant inputs have not changed since. `mtime` and `reviewedMaterialDigest` (task
  metadata/evidence, not source contents) are not proof. Otherwise the affected focused checks rerun.
- **Close tier** (`sprint-forge/assets/protocols/close-validation.md`): reconcile the sprint's changes
  with git first (working tree plus the sprint's commits; date-based commit selection is an approximation)
  and pass missing paths with `context-pack --sprint-file <path>`; then run `validation.sprint.commands`,
  task-created checks from `evidenceCandidates` that still apply, and focused checks for uncovered files.
  The aggregate runs at close only when declared in `close`, escalated, or justified by a cross-cutting
  change. Reconciliation only adds files, so selection may include extra checks.
- **Integration status.** Every close note records exactly one: `ran at close`, `satisfied by reused
  evidence` (with the tested-state reference), `deferred to <integrationBoundary>` (only when a named
  mechanism exists), `not configured`, or `pending: no integration mechanism identified`. Kyro neither
  runs nor verifies CI.

## `.agents/kyro/validation.json`

Optional and project-owned (commit it with `project.json`):

```json
{
  "validationVersion": 1,
  "task": [
    { "id": "api", "paths": ["src/api/**"], "commands": ["npm test -- src/api"] },
    { "id": "docs", "paths": ["docs/"], "commands": ["npm run lint:md"] }
  ],
  "fallback": ["npm run typecheck"],
  "close": ["npm run build"],
  "integration": ["npm run build", "npm test"],
  "integrationBoundary": ".github/workflows/ci.yml job `test` on pull requests",
  "escalate": ["src/db/**", "package.json"]
}
```

- All seven keys are required (`[]` / `null` allowed); an omitted key makes the map invalid.
- `close`: required at **every** sprint close, respected verbatim (an aggregate may be declared here).
- `integration`: the aggregate suite; runs at the integration boundary and at close only when escalated.
- `integrationBoundary`: the existing mechanism that runs `integration`, or `null`. A declaration only.
- `escalate`: minimum deterministic high-impact paths (same globs as `task.paths`). A sprint touching one
  adds `integration` to close validation. `escalated: false` means no pattern matched, not "low risk".
- `paths` accept `*`, `**`, `?` globs or a directory prefix, relative to the project root, and are used
  verbatim (spaces included). `./` and `\` in task files are normalized.
- A task file may end with one recognized change marker — ` (new)`, ` (created)`, ` (modified)`,
  ` (deleted)`, ` (removed)`, ` (renamed)`, case-insensitive — which is ignored for matching. Any other
  parenthesized text is part of the file name (`docs/guide (draft)`).

### Selection

1. Commands of every rule that matches any task file, in declared rule order.
2. Then `fallback`, when any task file matched no rule, or the task lists no files.
3. Global de-duplication keeps each command at its first position.

`validation.uncoveredFiles` lists task files with no matching rule — "no rule", never "validated". When
uncovered files exist and `fallback` is empty, the pack adds a warning and agents choose focused checks for
those files themselves; an empty command list is never a validation. Scope packs return `task: []`, the
`close` list, and — with an active sprint — the proportional `validation.sprint` selection below.

### Absent and invalid maps

- Absent: normal informational state — `"source": "none"`, empty lists, no warning.
- Invalid (bad JSON, unknown or missing keys, malformed rules): `"source": "none"`, a
  `validation map ignored: …` pack warning, and a MEDIUM `validation-tier` finding in `kyro analyze`.
  Routing is never blocked. In both cases there are no configured commands: close validation is a reasoned
  selection from criteria, the reconciled diff and project scripts, broadened to the project's full check
  for high-impact changes or with the limitation stated (`close-validation.md`).

### Sprint selection (`validation.sprint`)

Scope packs with an active sprint add `validation.sprint`:

- `files`: `{ path, source }` from task `files_to_touch` (non-disposed), evidence `files_changed`,
  disposed tasks' evidence (`disposed-evidence`: partial changes may remain), and `--sprint-file`
  (`reconciled`).
- `commands`: rule commands, `fallback` when a file has no rule or the set is empty, `close`, then
  `integration` when escalated — globally de-duplicated. Only configured commands appear here.
- `evidenceCandidates`: raw evidence `validation` lines per task. Free text, never commands.
- `uncoveredFiles`, `escalated`, `escalatedBy`, `escalationUnconfigured` (escalated with
  `integration: []`, plus a warning — never satisfied validation), `integration`, `integrationBoundary`.

## `kyro analyze`

Pending task criteria that name an `integration` command (other than commands also used by task rules or
the fallback; membership in `close` does not exempt it) or an explicit aggregate-suite phrase ("full test suite", "entire check", "suite completa", …)
produce a MEDIUM `validation-tier` finding. Focused phrasing such as "all tests in `test/x.test.js` pass" is
not flagged. Without a map, Kyro cannot know a project's aggregate command, so `npm run check passes` is not
inferred from script names. The finding is advisory: it never blocks close and never feeds the review veto.
