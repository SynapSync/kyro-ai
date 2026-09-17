---
title: 'change-current-work — Sprint 1: Handoff honesto y ediciones vivas'
date: '2026-09-17'
scope: 'change-current-work'
sprint: 1
slug: 'honest-handoff-and-live-edits'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 1: Handoff honesto y ediciones vivas

> Closed: 2026-09-17
> Outcome: shipped

## Objective

Convertir los bloqueos de edición del trabajo vivo en cambios locales, verificables y con un handoff que nunca anuncia ejecución inexistente.

## Definition of Done

- Los fixtures de Sprint 1 cubren los casos de handoff, --update-active y reglas locales con el CLI construido de este checkout.
- No se anuncia execute_task sin una tarea dependency-ready; la alternativa bloqueada expone remedyCommand estructurado.
- Las ediciones activas y reglas locales usan digest/apply, writer lock y doctor, conservan schema 4 y no crean un revision journal.
- Cada tarea tiene evidencia y veredicto pass; analyze y doctor --artifacts están limpios antes de cierre.

## Phases

### P0 — Fixtures rojos de trabajo vivo

> Fijar en sandboxes las regresiones de handoff, edición activa y reglas antes de cambiar escritores.

#### T1.1: Crear fixtures rojos y guardia de probes mutantes

**Status**: done

**Description**: Añadir fixtures table-driven que reproduzcan el handoff execute_task sin tarea lista, la eliminación de requisito y cancelación de tarea en la misma actualización activa, y update/remove/replace de regla local. Registrar que fallan contra 36c3897 antes de implementar; los probes que muten estado deben pasar exclusivamente por la guardia dedicada y ejecutar el CLI construido de este checkout.

**Evidence**:
- Summary: Made baseline-red fixtures execute and verify a built 36c3897 CLI through an explicit absolute worktree path.
- Validation: npm run build (passed)
- Validation: npm -C /home/rperaza/Projects/projects-worktrees/kyro-ai-36c3897 run build (passed)
- Validation: npm run check:change-current-work:red (passed; baseline 36c3897 red cases)
- Validation: npm run check:change-current-work (passed; current checkout green)
- Files changed: `scripts/check-change-current-work.mjs`, `package.json`
- Notes: Baseline worktree is /home/rperaza/Projects/projects-worktrees/kyro-ai-36c3897 at 36c3897b2d2fbd074fde5e44849b0dc6fa30b533; probes remain guarded sandbox invocations.

**Verdict**: pass

---
### P1 — Handoff honesto

> Derivar una ruta ejecutable real o un bloqueo accionable tras disponer trabajo vivo.

#### T1.2: Emitir blocker y remedyCommand cuando no hay trabajo listo

**Status**: done

**Description**: Centralizar el cálculo del handoff para que status y context-pack nunca anuncien execute_task sin nextTaskId listo. Cuando no exista trabajo ejecutable, exponer un blocker estructurado no_ready_work con objeto, motivo y remedyCommand copy-pastable, preservando la selección de trabajo independiente cuando sí exista.

**Evidence**:
- Summary: F5 preserves persisted lifecycle handoffs while recomputing task execution only after a writer changes execution state; stale execute_task remains corrected and verified work routes to qa_or_close.
- Validation: npm run check (passed: full repository suite)
- Validation: npm run check:change-current-work (passed: S1/S2 live-work routing fixtures)
- Validation: npm run check:qa-or-close (passed)
- Validation: npm run check:eval (passed: 31/31 behavioral evals)
- Validation: node dist/cli.js doctor --artifacts --kyro-scope change-current-work --json (passed)
- Files changed: `src/cli/core/status.ts`, `src/cli/commands/record-evidence.ts`, `scripts/check-change-current-work.mjs`
- Notes: Round 3 F5 correction. Built CLI used for all post-build checks; no lifecycle enum or schema change.

**Verdict**: pass

---
### P2 — Edición activa de requisitos y tareas

> Extender el digest/apply existente sin crear un journal para retirar consumidores vivos de forma atómica.

#### T1.3: Permitir remove/cancel en --update-active

**Status**: done

**Description**: Extender el contrato de plan --update-active para eliminar un requisito solo cuando la misma petición relinka o dispone todos sus consumidores vivos, y para cancelar una tarea en banda con razón. Reutilizar digest, lock, atomic replace, invalidación selectiva y doctor de Plan 14; mantener evidencia histórica y aprobaciones no afectadas.

**Evidence**:
- Summary: Added digest-protected active requirement removal with same-request task cancellation.
- Validation: npm run check:active-plan (16 groups passed)
- Validation: node scripts/check-change-current-work.mjs --active-plan-only (S1-S3 passed)
- Validation: node dist/cli.js doctor --artifacts --kyro-scope change-current-work --json (clean)
- Validation: git diff --check (passed)
- Files changed: `src/cli/core/active-plan.ts`, `src/cli/core/analysis.ts`, `src/cli/commands/plan.ts`, `scripts/check-change-current-work.mjs`
- Notes: Uses schema 4 atomic update-active digest/apply; cancelled task references are preserved as historical rather than live consumers.

**Verdict**: pass

---
### P3 — Reglas locales editables

> Hacer que una convención local pueda cambiar o desaparecer sin que la regla vieja siga efectiva.

#### T1.4: Añadir rule update, remove y replace locales

**Status**: done

**Description**: Implementar update, remove y replace para convenciones del scope; replace elimina la regla efectiva antigua y añade la nueva dentro de un único digest/apply, dejando el texto anterior disponible en historia local. Actualizar lectores y ayuda para que reglas retiradas no aparezcan como efectivas.

**Evidence**:
- Summary: Changed local rule update into an atomic retire-and-replace operation, preserving the former text as validated retired history while exposing only a newly allocated effective convention.
- Validation: npm run check:rule (passed)
- Validation: npm run check:change-current-work (passed)
- Validation: node dist/cli.js doctor --artifacts --kyro-scope change-current-work --json (passed)
- Files changed: `src/cli/commands/rule.ts`, `scripts/check-rule.mjs`
- Notes: Regression covers preview/digest/apply update, retained retired text, effective-pack filtering, and doctor validation; no global path is accepted or written.

**Verdict**: pass

---

## Unfinished work

_None — every task is done with a passing verdict._

## Learnings

_No learnings recorded._

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 2

_None recorded._
