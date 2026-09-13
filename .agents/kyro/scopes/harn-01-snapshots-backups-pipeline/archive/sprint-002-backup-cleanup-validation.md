---
title: 'harn-01-snapshots-backups-pipeline — Sprint 2: Limpieza y validación de backups'
date: '2026-09-10'
scope: 'harn-01-snapshots-backups-pipeline'
sprint: 2
slug: 'backup-cleanup-validation'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 2: Limpieza y validación de backups

> Closed: 2026-09-10
> Outcome: shipped

## Objective

Retener backups temporales del pipeline hasta la confirmación total, disponerlos tras éxito o rollback limpio, propagar fallos de snapshot sin mutar el target, y producir evidencia comparativa de instalación repetida sin prometer ahorro no medido.

## Definition of Done

- T2.1 y T2.2 están done con evidencia y verdict de aprobación.
- Un plan confirmado o revertido limpiamente deja cero backups temporales creados por ese plan; un rollback fallido conserva evidencia.
- Un fallo al crear snapshot se propaga sin mutar el target.
- S1/S2 de Sprint 1 siguen verdes; S3–S6 cubren R3–R5; checks focalizados, typecheck y build aplicables pasan.
- No se promete un ahorro cuantitativo más allá de la evidencia comparativa registrada; no hay trabajo fuera de HARN-01 Sprint 2.

## Phases

### P1 — Cobertura de ciclo de vida, fallos y métricas

> Convertir la fuga de backups residuales, el fallo de snapshot y la evidencia comparativa R5 en comprobaciones reproducibles que fallen en estricto hasta que exista la implementación.

#### T2.1: Extender la cobertura a limpieza, fallo de snapshot y comparación R5

**Status**: done

**Description**: Ampliar scripts/check-operation-snapshots.mjs (y el wiring del paquete si hace falta) con escenarios de ciclo de vida: un plan exitoso que crea backups de directorio no debe dejar kyro-pipeline-* residuales; un rollback limpio debe disponer esos backups; un fallo al crear el snapshot debe abortar sin mutar el target; y una línea COMPARATIVE (tiempo, bytes copiados, residuales) debe registrarse frente a la línea base de Sprint 1 sin afirmar un ahorro concreto. En modo estricto estas puertas deben fallar con el comportamiento actual (fuga en éxito, p. ej. rmdir-if-empty acting) para demostrar el gap; no implementar aún confirmación ni disposición. Conservar S1/S1b no-op y la matriz S2 de rollback. Incorpora las recomendaciones del Sprint 1: cobertura de limpieza diferida y medición reproducible antes de prometer ahorro.

**Evidence**:
- Summary: T2.1: extended scripts/check-operation-snapshots.mjs with S3–S6 lifecycle coverage without implementing confirmation/disposal. Strict mode fails as designed (LIFECYCLE_GATE_FAILED): S3 success-path remove leaves 1 kyro-pipeline-* residual; S4 clean rollback already 0 residuals; S4 failed-rollback keeps 1/2 backups (restoreTarget deletes evidence); S5 snapshot mkdtemp failure throws and leaves target intact but wraps as rollback completed (failClosed=false). COMPARATIVE line vs sprint-001 baseline with claimedSavings=false. S1/S1b no-ops + S2 6/6 still green (gate 0/0/0). package.json already wired check:operation-snapshots.
- Validation: node scripts/check-operation-snapshots.mjs (strict exit 1 LIFECYCLE_GATE_FAILED s3Residuals=1 s4FailedRemaining=1 s5FailClosed=false; S1/S2 PASS gate 0/0/0; COMPARATIVE printed claimedSavings=false)
- Validation: node scripts/check-operation-snapshots.mjs --baseline (exit 0 BASELINE_RECORDED; S1/S2 still pass)
- Validation: npm run typecheck (pass)
- Files changed: `scripts/check-operation-snapshots.mjs`

**Verdict**: pass

---
### P2 — Confirmación, disposición y fallos de snapshot

> Cerrar el ciclo de vida de backups del plan y hacer que un fallo de snapshot sea seguro, sin debilitar rollback ni las puertas R1/R2.

#### T2.2: Confirmar y disponer backups del plan; fallar cerrado al snapshotear

**Status**: done

**Description**: Implementar retención de backups de directorio hasta la confirmación total de la transacción y disposición únicamente de las rutas registradas por ese plan tras apply exitoso o rollback limpio. No borrar el backup durante restoreTarget de un paso individual si eso impide conservar evidencia cuando un rollback posterior falla; si el rollback completo falla, dejar los backups restantes para diagnóstico. Un fallo al crear el snapshot (mkdtemp o copia) debe lanzar antes de mutar el target. Actualizar las aserciones de S1b acting y las puertas S3–S6 para que el modo estricto pase a 0 residuales en éxito y rollback limpio, con S5 en rojo-a-verde. No cambiar locks, state.ts, ni HARN-02–07.

**Evidence**:
- Summary: T2.2: retain directory backups until plan confirm; dispose registered kyro-pipeline-* roots after successful apply or clean rollback; restoreTarget no longer deletes backups (failed rollback keeps remaining as evidence). Snapshot mkdtemp/cpSync failures throw SnapshotCreateError before mutating the target and are not wrapped as rollback completed when nothing applied. S1b acting + S3–S6 strict gates green: success/clean-rollback residuals=0, failed-rollback remaining=2, S5 failClosed=true, COMPARATIVE claimedSavings=false. No lock/state.ts/HARN-02–07 changes.
- Validation: npm run check:operation-snapshots (PASS: S1/S1b no-ops gate 0/0/0, S2 6/6, S3 residuals=0, S4 clean=0 failed remaining=2, S5 failClosed=true, COMPARATIVE claimedSavings=false)
- Validation: npm run typecheck (pass)
- Validation: npm run build (pass)
- Validation: npm run check:adapters (pass)
- Files changed: `src/cli/pipeline/operation-steps.ts`, `src/cli/pipeline/orchestrator.ts`, `src/cli/pipeline/types.ts`, `scripts/check-operation-snapshots.mjs`

**Verdict**: pass

---

## Unfinished work

_None — every task is done with a passing verdict._

## Learnings

- Retain directory backups until plan confirm; dispose only registered kyro-pipeline-* plan roots after successful apply or clean rollback — never glob-delete tmpdir.
- restoreTarget must not delete directory backups; a failed rollback keeps remaining plan backups as diagnostic evidence.
- SnapshotCreateError (mkdtemp/cpSync) must throw before mutating the target and must not be wrapped as rollback-completed when nothing applied.
- Do not claim quantitative install savings unless COMPARATIVE measurement records them (claimedSavings=false here).

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 3

- Roadmap 2/2 is exhausted — do not plan Sprint 3; ask whether to complete the scope.
- Optional follow-up only: inject a dedicated cpSync failure in S5, and surface failed dispose from confirm() instead of swallowing it.
