# Phase 0 Audit — bundle-cli-into-runtime

Read-tool verified (not grep/rg — RTK mangles `.replace(`-style output in this environment).

## 1. CLI-reference inventory (`skills/**`, `agents/orchestrator.md`)

Design §5.2 claimed **14 files / 33 occurrences**. Re-enumeration confirms the **file set (14) is accurate**, but the **occurrence count has drifted to 35** (two files gained an extra literal `kyro <subcommand>` reference since the design was written).

| File | Design count | Actual count | Delta |
|---|---|---|---|
| `agents/orchestrator.md` | 1 | 1 | — |
| `skills/qa-review/SKILL.md` | 1 | 1 | — |
| `skills/sprint-forge/SKILL.md` | 7 | 7 | — |
| `skills/sprint-forge/assets/modes/close-sprint.md` | 3 | 3 | — |
| `skills/sprint-forge/assets/modes/INIT.md` | 4 | 4 | — |
| `skills/sprint-forge/assets/modes/analyze.md` | 3 | **4** | **+1** |
| `skills/sprint-forge/assets/modes/review-task.md` | 3 | 3 | — |
| `skills/sprint-forge/assets/modes/plan-sprint.md` | 3 | 3 | — |
| `skills/sprint-forge/assets/modes/recover.md` | 2 | 2 | — |
| `skills/sprint-forge/assets/helpers/learner.md` | 2 | 2 | — |
| `skills/sprint-forge/assets/modes/clarify.md` | 1 | **2** | **+1** |
| `skills/sprint-forge/assets/modes/execute-task.md` | 1 | 1 | — |
| `skills/sprint-forge/assets/modes/STATUS.md` | 1 | 1 | — |
| `skills/sprint-forge/assets/templates/archive-sprint.md` | 1 | 1 | — |
| **Total** | **33** | **35** | **+2** |

Deltas found:
- `analyze.md` line 4 — `` Where `kyro doctor` validates the SHAPE of `sprint.json`, `kyro analyze` validates its MEANING. `` carries **two** literal invocations on one line; design's count of 3 apparently missed the `kyro doctor` half of that sentence.
- `clarify.md` line 56 — `` `kyro doctor --artifacts` (and `kyro analyze`) **fail** while any `[NEEDS CLARIFICATION]` marker `` also carries **two** literal invocations on one line; design's count of 1 missed the parenthetical `kyro analyze`.

Action for Phase 3 (§3.3 of tasks.md): when converting these two files, replace **both** occurrences per line, not one. This audit does not change any source file — it is a characterization snapshot only, per Phase 0's "no behavior change" contract.

`commands/{forge,status,wrap-up}.md` were spot-checked (Read tool) and confirmed to contain **zero** literal `kyro <subcommand>` CLI invocations — all references are to `kyro.json` (the state file) or `/kyro:*` slash commands. The design's exclusion of these three files from the substitution surface is **correct**.

## 2. `src/cli/adapters/codex.ts` — MCP command literal

`buildMcpProjection` (line 55) emits:

```ts
content: '[mcp_servers.kyro]\ncommand = \"kyro\"\nargs = [\"mcp\", \"serve\"]',
```

This is a **JS string literal**, not a `{{KYRO_CLI}}`-substitutable markdown/text copy — it is generated in code via `buildMcpProjection`, not copied from a source file. It is correctly **excluded** from the 14-file/35-occurrence placeholder-substitution surface and is tracked separately as **Phase 4** work (`resolveKyroInvocation()` wiring into the codex adapter). Not in scope for this PR (PR1 = Phase 0 + Phase 1 only).

## 3. PACKAGE_ROOT asset-parity audit

Design §3.2/§3.3 identified three PACKAGE_ROOT readers needing root-layout parity. All three confirmed present at the paths given, with one **path-documentation discrepancy**:

| Reader | Design-stated path | Actual path | Asset read | Parity status |
|---|---|---|---|---|
| `readPackageVersion` | `src/cli/help.ts` | `src/cli/help.ts` ✓ | root `package.json` | **FIX** — needs root `package.json` mirror (Phase 1) |
| `loadBudgetManifest` | `src/cli/core/budget-manifest.ts` | `src/cli/budget-manifest.ts` (**no `core/` subdirectory** — design path is stale) | `config.json` | **FIX** — needs root `config.json` mirror (Phase 1); today only `core/config.json` is projected |
| `routeModePath` | `src/cli/routing.ts:36` | `src/cli/routing.ts:36` ✓ | `skills/sprint-forge/assets/modes/{mode}` | OK — `skills/` already projected 1:1, no fix needed |

Note for future doc hygiene: `src/cli/core/` only contains `analysis.ts`, `errors.ts`, `policy.ts`, `scope-resolution.ts`, `scopes.ts`, `status.ts`, `trace.ts` — `budget-manifest.ts` lives directly under `src/cli/`, not `src/cli/core/`. This does not change the Phase 1 implementation surface (`install-plan.ts`), only the design doc's file reference is stale.

## 4. Additional workflow-command PACKAGE_ROOT reads (beyond §3.2/§3.3)

Read-tool inspection of `close-sprint.ts`, `analyze.ts`, `review.ts`, `repair.ts`, `scope.ts`, `trace.ts`:

- None of these six commands import `readJsonFromPackage`, `readPackageText`, or otherwise resolve a `PACKAGE_ROOT`-relative asset. They exclusively use `resolveManagedPath` (WORKSPACE_ROOT-relative artifact I/O: `sprint.json`, `kyro.json`, trace files) or in-process state (`readProjectState`).
- `context-pack.ts` imports `resolveRoute` from `routing.ts`, which is the existing `skills/` + `config.json` dependency already covered by design §3.2/§3.3 (routing-mode lookup + budget manifest). No new PACKAGE_ROOT surface found.

**Conclusion: design's "Net new mirrored assets: `dist/`, root `package.json`, root `config.json`" (design §3.3) is confirmed complete — no additional PACKAGE_ROOT readers exist beyond the three already identified.**

## Summary — deltas vs. design that matter for later phases

1. Placeholder-substitution occurrence count is **35, not 33** (file count of 14 unchanged) — `analyze.md` and `clarify.md` each need one additional inline occurrence replaced in Phase 3.
2. `src/cli/core/budget-manifest.ts` should read `src/cli/budget-manifest.ts` in design §3.2/§13 — cosmetic, no implementation impact.
3. No new PACKAGE_ROOT readers found; Phase 1's planned mirror set (`dist/`, root `package.json`, root `config.json`) is sufficient.
4. `codex.ts`'s `command = "kyro"` literal is correctly out of scope for the placeholder-substitution mechanism (Phase 3) — it is a Phase 4 code-level fix via `resolveKyroInvocation()`.

No `src/` files were changed in this phase (audit only).
