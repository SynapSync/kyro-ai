# Plan 13 — Guided Active-Sprint Resolution Before Scope Retirement

> **Status:** Proposed.  
> **Execution target:** `kyro-ai` repository.  
> **Release class:** Patch: router behavior, documentation, and contract tests only; no persisted-schema or CLI semantic change.  
> **Language:** Code, tests, documentation, and commits in English. Use Conventional Commits and no AI attribution.

## 1. Problem

A user can explicitly declare an active scope obsolete:

> “Close scope `<scope>`, I no longer need it” → “Retire as obsolete.”

`kyro scope retire` correctly rejects that request when `activeSprint` is non-null with `SPRINT_ALREADY_ACTIVE`. The retirement transaction must remain unable to silently clear an active sprint, because doing so would erase the task-level account of unfinished work.

The current `/kyro:scope-retire` router stops at that error and only says to resolve the sprint through Forge. This is not actionable for a whole-scope discard:

- Forge has no intent route for abandoning every remaining task before retirement.
- The router does not explain that every unfinished task needs a typed disposition.
- The existing, safe lifecycle is undiscoverable: record `cancelled` dispositions, close truthfully as `abandoned`, then prepare retirement again.
- A generic recommendation to close with `--outcome shipped` would be false after cancelled work; Kyro correctly permits only `partial`, `abandoned`, or `aborted` in that state.

The result is a UX dead end, not a CLI data-integrity defect.

## 2. Decision

Add a **guided, two-stage active-sprint resolution branch** to the canonical `/kyro:scope-retire` router. Do not add a new CLI verb and do not weaken `scope retire`'s `SPRINT_ALREADY_ACTIVE` guard.

The router becomes responsible for translating an explicit whole-scope discard into the already-supported, auditable sequence:

```mermaid
sequenceDiagram
  participant U as User
  participant R as scope-retire router
  participant C as Kyro CLI

  U->>R: Retire obsolete scope
  R->>C: scope retire (prepare)
  C-->>R: SPRINT_ALREADY_ACTIVE
  R->>U: Show unfinished tasks; ask cancellation authorization
  U-->>R: Explicit approval
  R->>C: record-evidence <each unfinished task> --disposition cancelled
  R->>C: close-sprint --outcome abandoned --dry-run
  R->>U: Show close plan; ask close authorization
  U-->>R: Explicit approval
  R->>C: close-sprint --outcome abandoned --yes
  R->>C: scope retire (fresh preparation)
  R->>U: Show retirement plan/digest; ask irreversible-retire question
  U-->>R: Explicit approval
  R->>C: scope retire --digest <digest> --yes
```

This preserves three independent decisions:

1. cancel unfinished task work;
2. publish the lossless, truthful abandoned-sprint checkpoint;
3. irreversibly retire the scope using its fresh, state-bound digest.

## 3. Contract and boundaries

### Must preserve

- `kyro scope retire` remains read-only on preparation and rejects an active sprint with `SPRINT_ALREADY_ACTIVE`.
- The retirement CLI still never closes or discards a sprint itself.
- The router never treats “close”, “complete”, or “finish” as retirement unless the user explicitly selects obsolete/superseded/discarded retirement.
- Every unfinished task must be written through `kyro record-evidence`; never edit `sprint.json`.
- Existing verified work (`status: done`, pass verdict, no disposition) remains untouched.
- The close checkpoint, snapshot, narrative, and ledger remain exclusively owned by `kyro close-sprint`.
- Retirement still requires a freshly prepared digest and a separate exact approval after the close changes state.
- `archive/` remains immutable.

### Router behavior after `SPRINT_ALREADY_ACTIVE`

1. Load the existing close-sprint mode and only the task details necessary to identify all active-sprint tasks.
2. Classify tasks:
   - **verified complete:** `done` plus a passing verdict and no disposition; retain unchanged;
   - **unfinished and undisposed:** eligible for the explicit `cancelled` disposition;
   - **already disposed:** retain the existing disposition and report it; do not overwrite it.
3. Present the exact IDs/titles that would receive `cancelled`, the user-provided discard reason, and the resulting close outcome `abandoned`.
4. Ask an explicit, scoped question such as:

   ```text
   ¿Autorizas cancelar las N tareas pendientes del sprint <n> de `<scope>`
   con motivo “<reason>” para poder cerrarlo como abandoned?
   ```

   Stop on any ambiguous, declined, or absent answer.
5. After approval, call `record-evidence` once per eligible task with:
   - `--disposition cancelled`;
   - the approved reason;
   - a factual decision summary (for example, “Scope discarded by explicit user request; task will not be implemented.”);
   - validation that identifies the explicit user decision, not a fabricated implementation test.
6. Run `close-sprint --outcome abandoned --dry-run`; present the entire plan and its dispositions.
7. Ask a separate close confirmation. Only then call the identical close command with `--yes`, including an honest note, summary, and learning.
8. Re-run retirement preparation from the new inactive state. Present its complete plan/digest and use the existing exact retirement approval question. Do not apply in that interaction.

### Error handling

- If task disposition, analysis, dry run, or close fails, stop and report the exact CLI error. Do not retry a different write or hand-edit state.
- If the active sprint changes after the cancellation approval, re-read and re-present affected tasks before performing further dispositions.
- If an unfinished task cannot accept a `cancelled` disposition (for example it is unexpectedly done or has a pass verdict), stop and ask the user how to resolve the new state.
- If close reports `BLOCKING_FINDINGS`, do not bypass the guard. Explain that retirement cannot proceed until the close prerequisites are resolved.
- If the post-close retirement preparation diverges, discard any prior retirement approval and restart retirement preparation. The prior cancellation and close remain valid audit events.

## 4. Implementation work

### A. Canonical router — `commands/scope-retire.md`

1. Add an **Active sprint resolution** section immediately after normal preparation.
2. Define the `SPRINT_ALREADY_ACTIVE` branch described in §3, including the three separate human gates.
3. Replace the generic “complete or otherwise resolve” fallback with concrete, CLI-owned commands and truthful `abandoned` wording.
4. Explicitly prohibit:
   - `scope complete` as a way to discard the scope;
   - `--outcome shipped` after task cancellation;
   - automatic task disposition or close merely because the user selected retirement;
   - applying retirement after a fresh preparation in the same turn.
5. Retain the existing normal no-active-sprint preparation/apply behavior byte-for-byte where possible.

### B. Sprint-close guidance — `internal/skills/sprint-forge/assets/modes/close-sprint.md`

1. Clarify that `cancelled`, `deferred`, `superseded`, and `blocked` dispositions make the close non-successful.
2. Document `--outcome abandoned` as the explicit outcome for a user-discarded sprint; reserve `shipped`/`completed` for all tasks verified complete.
3. State that the close mode can be loaded by the retirement router only after its cancellation authorization; it must not invoke retirement itself.

### C. Public documentation — `docs/cli.md` and `docs/commands-reference.md`

1. Add a concise “retiring a scope with an active sprint” subsection.
2. Explain the task-disposition → abandoned close → fresh retirement preparation chain.
3. Make the distinction explicit: `partial` is a truthful generic non-complete close; `abandoned` communicates an intentional whole-sprint discard.
4. Keep the API contract precise: this is router guidance over existing verbs, not an automatic `scope retire` capability.

### D. Contract tests — `scripts/check-scope-retire.mjs`

Add static/router-contract assertions that the canonical router:

- recognizes `SPRINT_ALREADY_ACTIVE` as a guided resolution branch;
- names `record-evidence --disposition cancelled` and `close-sprint --outcome abandoned`;
- demands a cancellation authorization, a close authorization, and the existing retirement approval separately;
- preserves the rule that retirement itself never closes/discards an active sprint;
- does not claim or imply `--outcome shipped` for disposed work;
- still stops after post-close retirement preparation and never auto-applies a digest.

Add an end-to-end lifecycle case in the same script or in a focused new script that uses a temporary fixture with a mixture of verified and pending tasks:

1. write `cancelled` dispositions only to pending tasks through `record-evidence`;
2. close with `--outcome abandoned`;
3. verify the immutable checkpoint/narrative preserve dispositions and the `abandoned` ledger outcome;
4. prepare and apply retirement with a fresh digest;
5. verify retired/done state, preserved archive bytes, and no mutation of verified-complete tasks.

## 5. Acceptance criteria

| ID | Criterion |
| --- | --- |
| AC-1 | An explicit obsolete/discarded request with an active sprint no longer ends in an unexplained Forge referral. |
| AC-2 | The router never writes a task disposition, closes a sprint, or retires a scope without the corresponding explicit human gate. |
| AC-3 | Every newly cancelled task is written only by `record-evidence`, with a non-empty approved reason and decision evidence. |
| AC-4 | Already verified-complete and already-disposed tasks are not overwritten. |
| AC-5 | The discarded sprint closes as `abandoned`, never as `shipped` or `completed`. |
| AC-6 | A successful close leaves `activeSprint: null`; retirement preparation then succeeds only through the existing digest-bound protocol. |
| AC-7 | Any close/retirement failure remains fail-closed and leaves archives untouched. |
| AC-8 | Normal retirement of an inactive scope and normal Forge completion routing remain unchanged. |
| AC-9 | Full check suite and focused lifecycle tests pass; generated `dist/` is fresh. |

## 6. Validation sequence

```bash
npm run build
npm run check:record-evidence
npm run check:close-handoff
npm run check:scope-retire
npm run check:command-modes
npm run check:routing
npm run check:dist
npm run check
```

Manual fixture exercise, performed only in a temporary workspace:

```bash
kyro record-evidence <pending-task> --kyro-scope demo \
  --summary "Scope discarded by explicit user request." \
  --validation "Explicit user decision to discard the scope." \
  --disposition cancelled --reason "The user explicitly discarded the entire scope."
kyro close-sprint --kyro-scope demo --outcome abandoned --dry-run
kyro close-sprint --kyro-scope demo --outcome abandoned --yes
kyro scope retire --kyro-scope demo --reason "The user explicitly discarded this scope."
# After separately displaying the plan and obtaining retirement approval:
kyro scope retire --kyro-scope demo --reason "The user explicitly discarded this scope." \
  --digest <reviewed-digest> --yes
```

## 7. Non-goals

- No `scope retire --force` flag.
- No hand-editing, deletion, or archive rewrite.
- No automatic interpretation of ordinary completion language as retirement.
- No new persistent schema, retirement checkpoint version, or change to `SPRINT_ALREADY_ACTIVE` behavior in the CLI.
- No change to normal Forge execution/completion flow.
- No publish, tag, push, or marketplace release without separate explicit authorization.

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| An agent treats the initial retirement choice as authorization to cancel work. | Require an independently worded cancellation approval and assert it in router tests. |
| Cancelled work is presented as successful delivery. | Require `abandoned`; reject `shipped`/`completed` contract wording for disposed tasks. |
| The router overwrites task history. | Classify verified and previously disposed tasks before writes; only act on unfinished/undisposed tasks. |
| A stale retirement digest is reused after the close. | Always re-run preparation; preserve the existing digest-bound apply gate. |
| Router prose drifts from CLI semantics. | Add static assertions plus a temporary-workspace end-to-end lifecycle test using the compiled CLI. |

## 9. Delivery

Suggested commit:

```text
fix(scope-retire): guide active sprint abandonment before retirement
```

If behavior is released, update the canonical version and synchronized release metadata according to `AGENTS.md`, then run the required build/check/pack gates. Do not release or publish without explicit authorization.
