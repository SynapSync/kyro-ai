# Validation tiers

Kyro separates **task validation** from **sprint validation** so agents do not rerun a project's aggregate
suite after every task. The agent-facing policy lives in
`internal/skills/sprint-forge/assets/protocols/validation.md` (Forge, its delegates and the standalone executor); Work carries an equivalent rule in its own skill with Work commands (`work amend-task`/`work amend-brief`, evidence `notes`) and, having no pack suggestions, picks focused checks from task criteria and files. This page documents the policy for humans.

| Tier | When | What runs |
|------|------|-----------|
| task | `execute_task` / `review_task` | Focused checks: `context-pack --task` → `validation.task`, plus focused checks for `validation.uncoveredFiles` |
| close | `qa_or_close` / `close_sprint` | Aggregate suite once per sprint: `validation.close`; no (valid) map → the project's full check |

## Policy

- **Focused by default.** Broaden, up to the aggregate suite, when a task changes cross-cutting contracts
  (shared types, build/packaging, install, wiring) and state the reason in `record-evidence --notes`.
  Avoid redundant aggregate runs.
- **Live criteria win.** `kyro review` checks every criterion. A criterion in force is satisfied (reusing
  valid evidence first) or corrected/waived through the authorized flow (`plan --update-active`,
  `review --waive-criterion`); it is never silently skipped. Planners therefore keep the aggregate suite in
  the sprint `definitionOfDone`, not in task criteria, unless the task is cross-cutting.
- **Expensive proofs** (mutation/revert, byte-identical history, package/install) run when the criteria or
  the contract under change require them, or when the task `context` starts with `High risk:`.
- **Evidence reuse.** A checker reuses maker evidence only when it records the command, a passing result
  and a verifiable reference to the tested state (a clean revision captured at test time that matches the
  current state, or the same session with verifiable absence of relevant changes, including other agents),
  and the relevant inputs have not changed since. `mtime` and `reviewedMaterialDigest` (task
  metadata/evidence, not source contents) are not proof. Otherwise the affected focused checks rerun.
- **Close tier.** Runs once per sprint. A passing run is reused only on the same relevant state; it reruns
  when a remediation changes its relevant inputs (administrative-only changes do not).

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
  "close": ["npm run build", "npm test"]
}
```

- All four keys are required; arrays may be empty. `close: []` declares that the project has no aggregate
  suite. An omitted key makes the map invalid.
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
those files themselves; an empty command list is never a validation. Scope packs return only `close`.

### Absent and invalid maps

- Absent: normal informational state — `"source": "none"`, empty lists, no warning.
- Invalid (bad JSON, unknown or missing keys, malformed rules): `"source": "none"`, a
  `validation map ignored: …` pack warning, and a MEDIUM `validation-tier` finding in `kyro analyze`.
  Routing is never blocked. In both cases close validation uses the project's full check.

## `kyro analyze`

Pending task criteria that name a `close` command (other than commands also used by task rules or the
fallback) or an explicit aggregate-suite phrase ("full test suite", "entire check", "suite completa", …)
produce a MEDIUM `validation-tier` finding. Focused phrasing such as "all tests in `test/x.test.js` pass" is
not flagged. Without a map, Kyro cannot know a project's aggregate command, so `npm run check passes` is not
inferred from script names. The finding is advisory: it never blocks close and never feeds the review veto.
