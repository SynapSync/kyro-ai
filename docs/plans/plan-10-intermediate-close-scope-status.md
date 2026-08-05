# Plan 10 — Intermediate Close Scope Status (fix + legacy v1 compatibility)

> **Versioned path:** `docs/plans/plan-10-intermediate-close-scope-status.md` (tracked by Git; safe to link from PRs).
>
> **Status:** Implemented in `6f39720`; locally certified after the semantic hardening in [Plan 11](./plan-11-legacy-checkpoint-semantic-hardening.md).
>
> Execution target: Grok / Codex / Claude. Repo: `kyro-ai` @ `develop`.
> Current version: **4.43.0** → target **4.43.1** (patch — bug fix + read-time compatibility; **no** `schemaVersion` bump).
> Language: all artifacts (code, comments, docs, commits, tests) in **English**. Conventional commits, **no AI attribution**.
> Branch prefix (required): `feature/...` (not `fix/...`).
> Related history: Plan 09 (status coherence) introduced `deriveScopeStatus`; lossless checkpoints shipped in **4.19.0** (`9bba1dc`) with intermediate `active → active`.
> Evidence: Codex sessions `019fd005-44b7-78e2-8c07-39f73c942062` (issue) and `019fd3be-8ec3-7711-b3a4-ee180cba2909` (diagnosis); re-verified against a **real consumer workspace** (`aliva-nutrilens-ai`) and `kyro-ai` source/history.

---

## 0. Executive summary

Closing an intermediate sprint under checkpoint v1 writes an immutable checkpoint whose `projectScopeAfter.status` stays `active`, while the canonical lifecycle rule (`deriveScopeStatus`) and `kyro repair` correctly derive `planning` when `activeSprint` is null and any roadmap sprint remains non-closed.

Observed on real consumer workspace `aliva-nutrilens-ai` / scope `service-foundation` under runtime 4.43.0:

```text
[FAIL] .../checkpoint/...: DIVERGED: sprint=after, scope=other, snapshot=ok, narrative=ok
```

Sprint close itself succeeded (checkpoint, snapshot, narrative, live sprint after-image). After a correct `repair`, `doctor --artifacts` fails. Agents that require doctor PASS are blocked from a clean next-sprint plan.

This plan:

1. Fixes **future** intermediate closes (`projectScopeAfter.status = planning`).
2. Accepts **historical checkpoint-v1 intermediate shape** (`projectScopeAfter.status = active`) at **read time only** (validate + doctor), without rewriting archives.
3. Ships **4.43.1**, verifies the candidate via **local package/tarball** (never `kyro-ai@latest` before publish), then unblocks the consumer workspace.

---

## 0.1 Review disposition (Codex HOLD → resolved)

| # | Codex finding | Disposition in this revision |
| --- | --- | --- |
| B1 | Compatibility must not be limited to 4.43.0; residual `active` began with v1 in **4.19.0** | §3.3 defines compatibility by **legacy intermediate v1 shape**, covering **4.19.0–4.43.0** population (no writer-version field exists) |
| B2 | Legacy fixture must be frozen, not built by post-fix builder then mutated | §4 Phase A: commit a **sanitized historical v1 checkpoint** with authentic digests/commitment |
| B3 | Release gate incomplete vs `docs/release-checklist.md` | §4 Phase E: full release order including `check:adapters`, `check:tokens`, `check:artifacts` + OPENSSL env |
| B4 | Candidate sync ambiguous (`@latest` still 4.43.0) | §4 Phase F: local `dist/cli.js` / local tarball only; publish/push behind separate authorization |
| C1 | Empty roadmap → `planning`, not `completed` | §3.1 documents SSOT + pathological edge + test requirement |
| C2 | `intendedAfterClose.status` must not be implementer-optional | §3.2 **out of scope**; preserve exact current formula |
| C3 | No standalone red test commit | §4 work units: tests ship **with** the fix |
| C4 | Plan under `.agents/` is gitignored | Moved to `docs/plans/` (this file) |
| C5 | Publish/push need external approval | §4 Phase G + §8 |
| C6 | Branch prefix `feature/` | §9 |
| C7 | Wording: “real consumer workspace”; drop unverifiable “Senior certification” | Applied throughout |

---

## 1. Problem statement (verified)

### 1.1 Consumer symptom

| Surface | Observed |
| --- | --- |
| Workspace | `aliva-nutrilens-ai` (real consumer workspace) |
| Scope | `service-foundation` |
| Runtime | Kyro **4.43.0** |
| Checkpoint | `archive/sprint-001-official-bootstrap-and-architecture.checkpoint.json` |
| `projectScopeBefore.status` | `active` |
| `projectScopeAfter.status` | `active` (legacy intermediate v1 behavior) |
| Live scope after repair | `planning` (canonical) |
| Live sprint | `activeSprint: null`, `nextAction: plan_sprint`, roadmap n=1 closed / n=2 planned |
| Doctor | `DIVERGED: sprint=after, scope=other` |

### 1.2 Causal chain

```text
close-sprint (checkpoint v1, since 4.19.0)
  └─ deriveSprintCloseTransition
       remaining > 0 → projectScopeAfter = { ...projectScopeBefore }   // keeps active
       remaining = 0 → status completed

repair / status / analyze
  └─ deriveScopeStatus(sprint, hasActiveSprint=false)
       roadmap length > 0 && every closed → completed
       else → planning   // includes: open sprints OR empty roadmap

doctor --artifacts (latest checkpoint live-compare)
  └─ digestPosition(liveScope, beforeDigest, afterDigest)
       live planning ≠ after active → scope=other → DIVERGED
```

### 1.3 Historical origin (not 4.43.0-only)

Git shows lossless checkpoint v1 and the intermediate assertion `active → active` shipped in **4.19.0**:

- Commit: `9bba1dc` — `chore(release): bump to 4.19.0 with lossless checkpoint feature…`
- Intermediate test text (then and now): *“Intermediate close retains active project scope status”* with `projectScopeBefore.status === 'active' && projectScopeAfter.status === 'active'`.

There is **no** `writerVersion` / `kyroVersion` field on the checkpoint. Compatibility **must** key off the **observable legacy intermediate shape**, not a release string. Affected population: any intermediate checkpoint produced under v1 rules from **4.19.0 through 4.43.0** (inclusive).

### 1.4 Source anchors

| File | Role | Defect / interaction |
| --- | --- | --- |
| `src/cli/checkpoints/sprint-close.ts` | `deriveSprintCloseTransition` | Intermediate close **copies** `projectScopeBefore` |
| `src/cli/core/status.ts` | `deriveScopeStatus` | SSOT: no active sprint + not (non-empty all-closed) → `planning` |
| `src/cli/commands/repair.ts` | scope reconcile | Correctly writes `planning` |
| `src/cli/commands/artifact-doctor.ts` | `inspectCheckpoint` | Exact digest match; third state → `DIVERGED` |
| `src/cli/checkpoints/sprint-close.ts` | `validateSprintCloseCheckpoint` | Re-derives transition; must accept legacy shape |
| `scripts/check-lossless-checkpoints.mjs` | Intermediate AC | Encodes legacy `active → active` |
| `docs/sprint-close-checkpoints.md` | Public contract | Recovery states; missing intermediate scope-status rule |
| `docs/release-checklist.md` | Release gates | Required order beyond bare `npm run check` |

### 1.5 Why a naive fix is dangerous

Changing only `deriveSprintCloseTransition` to emit `planning`:

1. `validateSprintCloseCheckpoint` re-derives with the new rule.
2. Historical intermediate checkpoints store `projectScopeAfter.status = active`.
3. Semantic equality fails → **CORRUPT** (worse than DIVERGED).
4. Recovery paths that call `readSprintCloseCheckpoint` can throw.

Therefore: correct **writes** + **narrow read-time** acceptance of the historical shape. **No** schema v2.

### 1.6 What is not broken

- Checkpoint immutability / self digests of existing archives under the historical rule.
- Sprint after-image alignment with live sprint when doctor reports `sprint=after`.
- Snapshot + narrative artifacts.
- Tool-owned `kyro plan` readiness when `handoff.nextAction === plan_sprint` (handoff already correct).
- Final close with non-empty all-closed roadmap → `completed` for scope entry (already intended).

---

## 2. Goals / non-goals

### 2.1 Goals

1. Intermediate closes emit `projectScopeAfter.status = planning`.
2. Final closes with non-empty all-closed roadmap emit `completed`.
3. `deriveScopeStatus(intendedAfterClose, false)` is the **sole** derivation of `projectScopeAfter.status` at close time.
4. Historical intermediate v1 checkpoints (`projectScopeAfter.status = active`, residual shape since 4.19.0) remain:
   - structurally valid under validate,
   - byte-immutable,
   - doctor-classifiable as APPLIED when live state is the canonical normalized after (`planning` with same id/title),
   - never rewritten.
5. Arbitrary divergences remain `DIVERGED` / `CORRUPT`.
6. Regressions cover **close → repair → doctor** and frozen historical fixture.
7. Ship **4.43.1** after full release checklist; verify consumer with **local candidate** (not npm `@latest` pre-publish).
8. Document rule + historical compatibility in `docs/sprint-close-checkpoints.md` + CHANGELOG.

### 2.2 Non-goals

- Schema v2 / envelope redesign.
- User-facing reconcile subcommand (not part of the CLI).
- Rewriting or backfilling historical checkpoints in consumer workspaces.
- Changing `SCOPE_STATUS_VALUES`.
- OpenSpec full cycle (optional process; not required for this patch).
- Planning the consumer’s next sprint before doctor is green under 4.43.1.
- **Sprint-level** `intendedAfterClose.status` normalization (explicitly out of scope — §3.2).
- npm publish, marketplace delivery, remote push, or PR merge without **separate explicit authorization**.

---

## 3. Design

### 3.1 Correct close transition (new writes)

In `deriveSprintCloseTransition`:

1. Build `intendedAfterClose` **exactly as today** for all fields except `projectScopeAfter` (see §3.2 for status field).
2. Set:

```ts
const projectScopeAfter: KyroScopeEntry = {
  ...projectScopeBefore,
  status: deriveScopeStatus(intendedAfterClose, false),
};
```

Because after close `activeSprint` is always null, `deriveScopeStatus` behaves as:

| After-close roadmap | Result |
| --- | --- |
| `length > 0` and every sprint `state === 'closed'` | `completed` |
| `length > 0` and at least one non-closed | `planning` |
| `length === 0` (empty array) | **`planning`** (not `completed`) |

**Empty-roadmap edge (must not be hand-waved):**

- Tool-owned `kyro plan` **rejects** empty `roadmap.sprints` (`plan.ts`: “must be a non-empty array”).
- Schema still **allows** an empty array on read (array present, no min-length).
- Today’s `remaining === 0` branch treats empty as final and would set scope `completed`.
- SSOT `deriveScopeStatus` treats empty as `planning`.
- **This patch adopts SSOT:** empty roadmap at close → `projectScopeAfter.status = planning`. That is a deliberate micro-change limited to pathological / hand-edited files.
- **Required test A9:** close with activeSprint present and `roadmap.sprints = []` → after status `planning` (locks SSOT; prevents reintroducing `remaining === 0` shortcuts).

Do **not** reintroduce a hand-rolled `remaining === 0 ? 'completed' : …` for `projectScopeAfter`.

### 3.2 `intendedAfterClose.status` — OUT OF SCOPE (locked)

Preserve **exactly** today’s formula:

```ts
status: remaining === 0 ? 'completed' : beforeClose.status,
```

Do **not** normalize sprint-level status as part of this patch.

Rationale:

- Expanding to sprint-level status changes `intendedAfterClose` digests and legacy semantic validation surface.
- That would enlarge compatibility work beyond the scope-entry bug.
- Sprint-level status is a separate concern from `projectScopeAfter` / doctor `scope=other`.

Implementer discretion: **none**. Any future sprint-level cleanup is a different plan.

### 3.3 Legacy compatibility (shape-based, not version-string-based)

Helper (export for tests as needed):

```ts
export function isLegacyIntermediateActiveScopeAfter(
  checkpoint: SprintCloseCheckpointV1,
): boolean
```

**All** conditions required (shape of historical intermediate v1, 4.19.0–4.43.0 population):

1. `checkpoint.schemaVersion === 1` (current `SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION`).
2. `checkpoint.intendedAfterClose.activeSprint === null`.
3. Roadmap has **at least one** sprint with `state !== 'closed'` (true intermediate; empty roadmap is **not** this legacy residual — empty never stored residual `active` via the intermediate copy path in the same way as “remaining > 0 keep before”; intermediate path was `remaining > 0 → copy before`. Empty has remaining 0 → wrote `completed` historically. Do **not** treat empty+active as legacy intermediate).
4. `checkpoint.projectScopeBefore.status === 'active'`.
5. `checkpoint.projectScopeAfter` is canonically identical to `projectScopeBefore` (historical v1 copied the complete entry).
6. Re-deriving with the **new** rule yields an entry equal to stored `projectScopeAfter` **except** `status: 'planning'`.
7. Checkpoint internal digests remain self-consistent under existing digest checks (fixture must be authentic).

Use in:

#### A) `validateSprintCloseCheckpoint`

If `canonicalJson(derived.projectScopeAfter) !== canonicalJson(typed.projectScopeAfter)`:

- allow only when `isLegacyIntermediateActiveScopeAfter(typed)` is true;
- otherwise push the existing unauthorized-transition issue.

`intendedAfterClose` equality remains **strict** (no change to sprint-level status).

#### B) `inspectCheckpoint` (doctor live compare)

When live scope digest is not exact before/after:

- If legacy helper matches **and** live entry equals:

```ts
{ ...checkpoint.projectScopeAfter, status: 'planning' }
```

  treat `scopePosition` as **after** → overall APPLIED when sprint/artifacts already after/ok.

- Message must remain stable for tests, e.g.:

```text
APPLIED: sprint=after, scope=after (legacy v1 intermediate scope status active→planning), snapshot=ok, narrative=ok
```

- Live still exact-matching historical `active` after → also APPLIED (never-repaired consumer).
- Any other drift → `DIVERGED`.

Compatibility is **read-time only**. Never rewrite checkpoint bytes or ledger commitments.

### 3.4 CAS / resume safety

Leave `compareAndSwapProjectScope*` fail-closed:

- live === after → noop
- live === before → write after
- else → DIVERGED

Repaired live `planning` vs historical after `active` → DIVERGED on resume (**desired**; no re-poison to `active`).

Add regression that doctor/repair do not rewrite checkpoint; CAS does not silently force legacy after onto repaired planning.

### 3.5 Versioning

- Patch **4.43.1**.
- Keep `SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION = 1`.
- Sync: `package.json`, `package-lock.json` (root), `.claude-plugin/plugin.json`, `WORKFLOW.yaml`, `CHANGELOG.md`.

---

## 4. Implementation work units

### Preferred shipping shape

**One behavior unit** (tests + fix together — **no red standalone commit**):

```text
fix(checkpoints): reconcile intermediate close scope status
```

Optional follow-ups (only if review size demands):

```text
docs(checkpoints): document intermediate scope status and legacy v1 compatibility
chore: bump version to 4.43.1
```

Documentation may ship with the fix or immediately after. **Release metadata (version bump) may be a separate commit** but must not land without green behavior commit.

Forbidden: a commit that only adds failing tests and leaves `develop`/CI red.

### Phase A — Regressions (ship with Phase B in the same commit)

**Primary:** `scripts/check-lossless-checkpoints.mjs`
**Fixture dir (versioned):** `fixtures/checkpoints/legacy-v1-intermediate-active-scope/`

| ID | Scenario | Assertions |
| --- | --- | --- |
| A1 | Intermediate close (new path) | `projectScopeAfter.status === 'planning'`; `plan_sprint`; doctor APPLIED |
| A2 | Final close (non-empty all closed) | `completed`; doctor APPLIED |
| A3 | Intermediate close → `repair` → doctor | repair idempotent; doctor APPLIED |
| A4 | **Frozen historical fixture** + live scope `planning` (normalized after) | doctor APPLIED + legacy marker; **checkpoint file SHA unchanged** |
| A5 | Frozen fixture + live title/id mutated | DIVERGED |
| A6 | Frozen fixture + live status not `planning`/`active`-exact | DIVERGED |
| A7 | Doctor/repair do not rewrite fixture bytes | byte identity |
| A8 | CAS/resume does not re-poison repaired `planning` with legacy `active` | fail-closed / no silent write |
| A9 | Empty `roadmap.sprints` at close | `projectScopeAfter.status === 'planning'` (SSOT edge) |

#### Frozen fixture rules (blocking)

- **Do not** generate the compatibility fixture via the post-fix builder and then mutate fields.
- Commit a **minimal sanitized** checkpoint produced under the **historical v1 intermediate rule** (residual `projectScopeAfter.status = active`), including:
  - authentic `digests.*` for the stored payload,
  - authentic ledger `checkpointSha256` / commitment fields as required by validate,
  - stable identity/paths suitable for a sandbox (sanitize absolute paths / PII; keep cryptographic self-consistency).
- Preferred provenance: extract from a known historical intermediate close (e.g. consumer archive or 4.19.0-era sandbox capture), then sanitize **without** changing digest-covered status semantics incorrectly — if sanitization changes covered bytes, recompute digests only with a **one-time offline tool pinned to historical semantics**, and commit the final JSON as static golden data.
- Test harness **loads the golden file as-is**; it must not call `buildSprintCloseCheckpoint` / `deriveSprintCloseTransition` to create A4.

Also grep `scripts/check-status.mjs` and `scripts/check-sprint-doctor-v4.mjs` for intermediate `active` assumptions; update only if they hardcode the bug.

### Phase B — Production fix (same commit as Phase A)

**`src/cli/checkpoints/sprint-close.ts`**

1. Import `deriveScopeStatus`.
2. Derive `projectScopeAfter.status` via §3.1.
3. Leave `intendedAfterClose.status` formula unchanged (§3.2).
4. Add `isLegacyIntermediateActiveScopeAfter`.
5. Soften semantic validate only for that helper (§3.3.A).

**`src/cli/commands/artifact-doctor.ts`**

1. Live-compare equivalence for legacy intermediate shape (§3.3.B).
2. Keep status enum values; enrich message text only.

**Do not** change `repair.ts` behavior (already correct).

### Phase C — Documentation

- `docs/sprint-close-checkpoints.md`
  - Intermediate: `projectScopeAfter.status = planning`.
  - Final (non-empty all-closed): `completed`.
  - Empty roadmap: `planning` under SSOT; tool-owned plan forbids empty; schema may still allow.
  - Historical intermediate v1 residual `active` (since 4.19.0): read-time validate/doctor acceptance; **no rewrite**.
- `CHANGELOG.md` → `## [4.43.1]`:
  - Fix intermediate scope status drift.
  - Read-time compatibility for historical intermediate v1 residual `active`.
  - Empty-roadmap edge follows `deriveScopeStatus` (`planning`).
  - No schema bump; no archive rewrite.

### Phase D — Version sync (4.43.1)

1. `package.json`
2. `package-lock.json` (root package version entries)
3. `.claude-plugin/plugin.json`
4. `WORKFLOW.yaml`
5. `CHANGELOG.md`

### Phase E — Release validation gate (complete)

Use the repository release checklist order and the project OPENSSL/cache/shell env where required:

```bash
export OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf
export npm_config_cache=/tmp/kyro-ai-npm-cache
export npm_config_script_shell=/bin/zsh

# 1. Full static suite (includes typecheck, versions, dist freshness, lossless checkpoints, etc.)
npm run check

# 2. Regenerate runtime
npm run build

# 3. Adapter projection against built runtime
npm run check:adapters

# 4. Token + artifact integrity (NOT covered solely by `npm run check`)
npm run check:tokens
npm run check:artifacts

# 5. Pack simulation only after the above pass
npm pack --dry-run
```

During iteration, targeted loops may use:

```bash
npm run build
npm run check:lossless-checkpoints
npm run check:status
npm run check:sprint-doctor-v4
npm run check:close-handoff
```

**Ship gate is Phase E complete**, not the targeted loop alone.

### Phase F — Candidate verification on consumer workspace (pre-publish)

**Do not** use `npx kyro-ai@latest` to verify 4.43.1 before it is published — it still resolves **4.43.0**.

Allowed candidate paths (pick one, document which was used):

1. **Local full package CLI from the kyro-ai checkout** (preferred while developing):

```bash
# from aliva-nutrilens-ai (or pass explicit cwd)
OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf \
  node /Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-ai/dist/cli.js \
  doctor --artifacts --kyro-scope service-foundation

OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf \
  node /path/to/kyro-ai/dist/cli.js status --kyro-scope service-foundation
```

2. **Local tarball install into a throwaway prefix or the projected runtime**, only after `npm pack` of the candidate:

```bash
# in kyro-ai after Phase E
npm pack   # produces kyro-ai-4.43.1.tgz
# install that tarball into the runtime location the consumer uses, OR
# invoke the packed package's cli entry without publishing to npm
```

3. If the consumer uses projected runtime under `~/.agents/kyro/current`, refresh it from the **local** package/tarball / `dist` sync path the project already documents — still **not** `@latest` from the registry pre-publish.

**Expected on consumer:**

- Doctor PASS (APPLIED; may include legacy intermediate note).
- Live scope remains `planning`.
- Checkpoint file **byte-identical** pre/post verification.
- Explicit scope flag used (`--kyro-scope service-foundation`) to avoid activeScope ambiguity.

### Phase G — Authorization-gated delivery

Requires **separate explicit user authorization** for each:

| Action | Default |
| --- | --- |
| `git push` | ask first |
| Open/update PR | ask first |
| `npm publish` | ask first |
| Marketplace / plugin publish | ask first |
| Merge to `main` / release tag | ask first |

Implementation and local commits on a feature branch may proceed once this plan is accepted; remote/publish steps wait for approval.

---

## 5. File touch map

| Path | Action |
| --- | --- |
| `docs/plans/plan-10-intermediate-close-scope-status.md` | This plan (versioned) |
| `src/cli/checkpoints/sprint-close.ts` | Derive fix + legacy validate helper |
| `src/cli/commands/artifact-doctor.ts` | Legacy live digest equivalence |
| `src/cli/core/status.ts` | Read-only SSOT (no logic change expected) |
| `scripts/check-lossless-checkpoints.mjs` | Fix wrong AC + regressions A1–A9 |
| `fixtures/checkpoints/legacy-v1-intermediate-active-scope/` | Frozen historical golden |
| `scripts/check-status.mjs` / `check-sprint-doctor-v4.mjs` | Only if they hardcode legacy bug |
| `docs/sprint-close-checkpoints.md` | Contract |
| `CHANGELOG.md` | 4.43.1 |
| `package.json` / lock / plugin / `WORKFLOW.yaml` | Version sync |

**Removed/non-canonical:** `.agents/plans/...` (gitignored; not PR-linkable). Do not reintroduce the plan only under `/.agents/`.

---

## 6. Acceptance criteria

### 6.1 Behavioral

- [x] Intermediate close writes `projectScopeAfter.status === 'planning'`.
- [x] Final close (non-empty all-closed roadmap) writes `completed`.
- [x] Empty-roadmap close writes `planning` (A9).
- [x] `intendedAfterClose.status` formula unchanged from pre-patch.
- [x] New intermediate: doctor APPLIED without requiring repair; repair idempotent (A3).
- [x] Frozen historical intermediate v1 fixture + live `planning` → APPLIED legacy path; bytes unchanged (A4/A7).
- [x] Arbitrary live drift still DIVERGED (A5/A6).
- [x] Corrupt digests/identity still CORRUPT.
- [x] No schemaVersion bump; no checkpoint rewrite tooling.

### 6.2 Engineering / release

- [x] Behavior tests and fix land in the **same** non-red commit unit.
- [x] Phase E full release gate green (check → build → adapters → tokens → clean-export artifacts → pack dry-run) with OPENSSL/cache/shell env as needed.
- [x] Versions synced at 4.43.1.
- [x] CHANGELOG + checkpoint docs updated.
- [x] Consumer doctor green under **local candidate** 4.43.1 (not registry `@latest` pre-publish).
- [x] Plan path `docs/plans/...` is committed so PR can link it.

### 6.3 Explicitly out of pass criteria

- Consumer Sprint 2 planned/executed.
- npm/marketplace publish (authorization-gated).
- Sprint-level status normalization.

---

## 7. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Fix without legacy validate soft-match | Historical archives become CORRUPT | Dual-surface compatibility (validate + doctor) |
| Compatibility keyed to “4.43.0” only | Misses 4.19.0–4.42.x archives | Shape-based helper; document 4.19.0 origin |
| Over-broad legacy predicate | Real divergences masked | All §3.3 conditions; intermediate only; empty excluded from residual-active path |
| Fixture built from new builder | Regression tracks future code | Frozen golden only |
| Empty roadmap mis-documented as completed | Wrong AC / SSOT drift | A9 + §3.1 table |
| Red test-only commit | CI red on partial apply | Single behavior unit |
| `@latest` verification | False green on 4.43.0 | Local dist/tarball only pre-publish |
| Re-poison via CAS | Live forced back to active | Leave CAS fail-closed; A8 |

---

## 8. Forbidden remediations

1. Hand-edit consumer `*.checkpoint.json`.
2. Force live scope to `active` to silence doctor.
3. Delete archive to “fix” doctor.
4. Plan next consumer sprint while doctor still FAILs on 4.43.0.
5. Introduce schemaVersion 2 for this field.
6. Add user-facing reconcile as primary fix.
7. Verify candidate via `npx kyro-ai@latest` before publish.
8. Push / PR / publish without separate explicit authorization.
9. Standalone red test commit.
10. Change `intendedAfterClose.status` formula in this patch.

---

## 9. Implementation checklist

1. Branch from `develop`: **`feature/intermediate-close-scope-status`** (required `feature/` prefix).
2. Ensure this plan is committed under `docs/plans/` (already versioned path).
3. Add frozen golden fixture under `fixtures/checkpoints/legacy-v1-intermediate-active-scope/`.
4. Implement Phase A tests + Phase B fix in **one** behavior commit.
5. Run targeted checks until green, then **full Phase E**.
6. Docs + CHANGELOG; version bump 4.43.1 (same or follow-up commit).
7. Phase F consumer verification with local candidate + OPENSSL_CONF + explicit `--kyro-scope`.
8. Stop for authorization before push/PR/publish (Phase G).

---

## 10. Commit / PR guidance

**Behavior commit:**

```text
fix(checkpoints): reconcile intermediate close scope status

Intermediate sprint closes kept projectScopeAfter.status=active since
checkpoint v1 (4.19.0), while deriveScopeStatus and repair correctly
produce planning when no sprint is active. Doctor then reported DIVERGED
after a correct repair.

Derive projectScopeAfter via deriveScopeStatus, accept the narrow
historical intermediate v1 residual active shape at validate/doctor time
without rewriting checkpoints, and lock close→repair→doctor plus a frozen
legacy fixture in lossless checkpoint checks.
```

**PR description must link:**

`docs/plans/plan-10-intermediate-close-scope-status.md`

Include: consumer reproduction summary, Phase E command results, Phase F local-candidate method used.

---

## 11. Relationship to prior work

| Item | Relationship |
| --- | --- |
| Plan 09 — Status coherence | Introduced `deriveScopeStatus` + repair/analyze; close transition not fully aligned |
| 4.19.0 lossless checkpoints (`9bba1dc`) | Introduced v1 envelope + intermediate `active → active` test/behavior |
| `docs/release-checklist.md` | Authoritative release gate order for 4.43.1 |

---

## 12. Success definition

After 4.43.1, intermediate closes emit `planning`, final non-empty all-closed closes emit `completed`, empty-roadmap closes follow SSOT (`planning`), doctor stays green for new closes and historical intermediate v1 residual-`active` checkpoints without rewriting archives, and the consumer workspace can plan its next sprint under a clean `doctor --artifacts` verified with a **local** 4.43.1 candidate.

---

## 13. Appendix — Evidence snapshot

```json
{
  "checkpoint": {
    "schemaVersion": 1,
    "beforeScope": { "status": "active" },
    "afterScope": { "status": "active" },
    "afterActiveSprint": null,
    "afterHandoff": { "nextAction": "plan_sprint" },
    "roadmap": [{ "n": 1, "state": "closed" }, { "n": 2, "state": "planned" }]
  },
  "live": {
    "scope": { "status": "planning" },
    "activeSprint": null,
    "handoff": { "nextAction": "plan_sprint" }
  },
  "doctor": "DIVERGED: sprint=after, scope=other, snapshot=ok, narrative=ok",
  "historicalOrigin": "4.19.0 (9bba1dc) intermediate active→active"
}
```

Inert session references:

- Issue: `019fd005-44b7-78e2-8c07-39f73c942062`
- Diagnosis: `019fd3be-8ec3-7711-b3a4-ee180cba2909`
