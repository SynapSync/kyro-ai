---
title: 'change-current-work — Sprint 2: Roadmap, discard y excepción de skill'
date: '2026-09-17'
scope: 'change-current-work'
sprint: 2
slug: 'roadmap-discard-and-skill'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 2: Roadmap, discard y excepción de skill

> Closed: 2026-09-17
> Outcome: shipped

## Objective

Permitir reorganizar entradas planned del roadmap, descartar un scope vivo orquestando writers existentes con un consentimiento, y hacer que el skill consuma remedyCommand + doctor, sin schema 5 ni journal Plan 15.

## Definition of Done

- Entradas planned del roadmap se retitulan, añaden, cancelan o reordenan con plan --roadmap sin cambiar identidades closed/active.
- scope discard, con un consentimiento informado, cancela trabajo undisposed, cierra abandoned y retira el scope reusando writers existentes; el mismo digest es reanudable.
- El skill aplica remedyCommand de trabajo vivo ya autorizado y corre doctor; discard sigue pidiendo usuario.
- Schema 4; sin plan --revise, sin journal Plan 15, reglas local-only; probes mutantes con guarded-cli-probe y node dist/cli.js.
- Cada tarea tiene evidencia y veredicto pass; analyze y doctor --artifacts limpios antes de cierre.

## Phases

### P0 — Fixtures rojos de roadmap, discard y skill

> Fijar en sandboxes las regresiones de plan --roadmap, scope discard y la excepción de skill antes de cambiar escritores.

#### T2.1: Crear fixtures rojos de roadmap, discard y skill

**Status**: done

**Description**: Extender los fixtures table-driven de change-current-work para reproducir: (1) la imposibilidad de retitular/añadir/cancelar/reordenar entradas planned del roadmap, (2) la cadena de aprobación para descartar un scope vivo (retire rehúsa con activeSprint), y (3) la ausencia de un helper de skill que aplique remedyCommand y luego doctor. Registrar que fallan contra 36c3897 antes de implementar. Los probes que muten estado deben pasar exclusivamente por scripts/lib/guarded-cli-probe.mjs y ejecutar node dist/cli.js de este checkout, nunca PATH kyro ni plan --revise.

**Evidence**:
- Summary: Added guarded 36c3897 red fixtures for planned-roadmap edits, active-scope discard, and live-work remedy/doctor helper; probes pin an explicit checkout CLI.
- Validation: npm run check:change-current-work:red (passed: all S1-S6 fixtures recorded as red against 36c3897)
- Validation: node --check scripts/check-change-current-work.mjs && node --check scripts/lib/guarded-cli-probe.mjs && git diff --check (passed)
- Validation: test -z "" (passed: no staged files)
- Files changed: `scripts/check-change-current-work.mjs`, `scripts/lib/guarded-cli-probe.mjs`, `package.json`
- Notes: No Kyro-managed state was edited directly; guarded probes use synthetic roots and explicit absolute dist/cli.js paths.

**Verdict**: pass

---
### P1 — plan --roadmap solo planned

> Editar el futuro del roadmap sin tocar identidades closed o active y sin mezclarlo con --update-active.

#### T2.2: Añadir plan --roadmap para entradas planned

**Status**: done

**Description**: Implementar un escritor dedicado kyro plan --roadmap (preview digest / apply --yes) que permita retitular, añadir, cancelar o reordenar en presentación sólo entradas con state planned. Rechazar renumerar o mutar identidades closed/active. No mezclar con --update-active. Reutilizar writer lock y atomicReplace de Plan 14. Cancelled planned se omiten en materialización, no se resucitan. Schema 4; sin plan --revise ni journal.

**Evidence**:
- Summary: Implemented dedicated digest-protected plan --roadmap writer for planned-only retitle, add, cancel, and presentation reorder operations.
- Validation: npm run typecheck (passed)
- Validation: npm run build (passed)
- Validation: node scripts/check-change-current-work.mjs --roadmap-only (passed: S4 planned-only writer, preview/apply, immutable active rejection, doctor)
- Validation: git diff --check && git diff --cached --check (passed)
- Files changed: `src/cli/commands/plan.ts`, `scripts/check-change-current-work.mjs`
- Notes: Uses writer lock and atomic replace; schema remains 4 and cancelled roadmap entries are excluded from materialization count.

**Verdict**: pass

---
### P2 — Discard de scope con un consentimiento

> Descartar un scope vivo orquestando writers existentes bajo un digest/yes, sin WAL nuevo.

#### T2.3: Orquestar scope discard con un consentimiento

**Status**: done

**Description**: Añadir kyro scope discard --dry-run / --digest --yes que prepare un plan sobre verbos existentes: cancelar tareas undisposed (disposition cancelled + razón de discard), close-sprint --outcome abandoned, y scope retire. Un consentimiento informado autoriza las etapas. Interrupt → reintentar el mismo digest; cada etapa es el writer idempotente ya existente. No crear WAL multi-archivo. close-sprint y scope retire standalone no cambian. --yes es mecánico; el discard en sí es consentimiento humano (CONFIRMATION_REQUIRED sin --yes).

**Evidence**:
- Summary: Implemented digest-protected scope discard orchestration using existing cancellation, abandoned-close, and retirement writers.
- Validation: npm run typecheck (passed)
- Validation: npm run check:scope-retire (passed)
- Validation: npm run check:change-current-work exercised S5 successfully; later S6 fails only because T2.4 helper is intentionally pending
- Files changed: `src/cli/commands/scope.ts`, `src/cli/checkpoints/scope-retirement.ts`, `src/cli/types.ts`, `src/cli/app.ts`, `scripts/check-change-current-work.mjs`
- Notes: Schema remains 4; mutating fixture probes used guarded-cli-probe and this checkout dist/cli.js.

**Verdict**: pass

---
### P3 — Helper de skill + doctor

> Que forge/executor aplique remedyCommand de trabajo vivo ya autorizado y corra doctor, pidiendo usuario sólo para discard u autoridad ambigua.

#### T2.4: Añadir helper de skill que consume remedyCommand y corre doctor

**Status**: done

**Description**: Añadir un helper de trabajo vivo (no live-revision de Plan 15) y cablearlo en forge/executor: si el pack expone remedyCommand y el cambio está dentro de trabajo vigente ya autorizado (casos 1–3: --update-active, rule local, plan --roadmap), aplicarlo y luego doctor --artifacts con el CLI de este checkout. Pedir usuario sólo para discard, política de proyecto o significado ambiguo. Proyección clean-HOME: el helper shipped no enseña plan --revise, schema 5 ni journal. Reglas siguen local-only.

**Evidence**:
- Summary: Moved live-work protocol detail to the lazy helper and trimmed execute routing; all live-work acceptance checks remain green.
- Validation: npm run check:token-budgets (54 assertions passed; 3 warnings)
- Validation: npm run check (passed)
- Validation: npm run check:change-current-work (live-work fixtures passed)
- Validation: npm run check:change-current-work:red (36c3897 red fixtures recorded)
- Files changed: `commands/forge.md`, `internal/skills/sprint-forge/assets/modes/execute-task.md`, `internal/skills/sprint-forge/assets/helpers/live-work.md`
- Notes: No runtimeForge*Tokens ceiling changed; schema remains 4; no --global or Plan 15.

**Verdict**: pass

---

## Unfinished work

_None — every task is done with a passing verdict._

## Learnings

_No learnings recorded._

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 3

_None recorded._
