---
title: 'harn-01-snapshots-backups-pipeline — Sprint 1: Política de snapshots específicos'
date: '2026-09-09'
scope: 'harn-01-snapshots-backups-pipeline'
sprint: 1
slug: 'snapshot-policy'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 1: Política de snapshots específicos

> Closed: 2026-09-09
> Outcome: shipped

## Objective

Establecer una línea base reproducible y evitar snapshots recursivos para operaciones del pipeline que se determinan sin efecto, preservando el rollback de operaciones mutadoras.

## Definition of Done

- T1.1 y T1.2 están done con evidencia y verdict de aprobación.
- La cobertura prueba ausencia de snapshots para no-ops y preservación de rollback para mutaciones.
- Los checks focalizados, typecheck y build aplicables pasan.
- No se implementa limpieza de confirmación ni trabajo fuera de HARN-01 Sprint 1.

## Phases

### P1 — Línea base y regresión

> Convertir el problema observado en cobertura reproducible antes de alterar la política de snapshots.

#### T1.1: Crear cobertura reproducible de snapshots del pipeline

**Status**: done

**Description**: Añadir una comprobación aislada que ejercite applyOperationPlan sobre un directorio existente y demuestre el comportamiento actual: mkdir no-op no debe alterar el target, y la suite debe poder detectar una copia recursiva o un backup temporal residual. Registrar una línea base de tiempo, bytes copiados y backups residuales para una instalación o plan repetido representativo, sin prometer ahorro previo.

**Evidence**:
- Summary: T1.1: added scripts/check-operation-snapshots.mjs exercising applyOperationPlan mkdir no-op over an existing dir with content; S1 x3 baseline records targetIntact=true with 1 recursive copy (~67KB) and 1 kyro-pipeline-* residual per no-op; wired npm run check:operation-snapshots into package check chain; strict gate proven failing pre-policy for T1.2.
- Validation: node scripts/check-operation-snapshots.mjs (baseline exit 0, BASELINE_RECORDED)
- Validation: node scripts/check-operation-snapshots.mjs --strict (exit 1 STRICT_GATE_FAILED pre-policy, gate proof)
- Validation: npm run check:operation-snapshots (exit 0 via package wiring)
- Validation: npm run typecheck (pass)
- Validation: npm run build (pass)
- Files changed: `scripts/check-operation-snapshots.mjs`, `package.json`

**Verdict**: pass

---
### P2 — Política específica por operación

> Eliminar snapshots innecesarios para no-ops sin degradar rollback de operaciones que sí mutan.

#### T1.2: Aplicar snapshots conservadores por operación

**Status**: done

**Description**: Refactorizar la preparación de OperationStep para decidir si una operación requiere snapshot según acción y estado actual del target. mkdir sobre un directorio existente y rmdir-if-empty cuando no vaya a mutar no deben crear backup; ante estado ambiguo o mutación posible se debe conservar snapshot suficiente. Mantener el comportamiento de rollback para write, copy, remove, bloque JSON, symlinks, permisos y targets ausentes. No implementar la limpieza de confirmación global, que pertenece al Sprint 2.

**Evidence**:
- Summary: T1.2: operationNeedsSnapshot/snapshotIfNeeded in operation-steps.ts skips directory backups only for provable no-ops (mkdir over existing dir; rmdir-if-empty on missing/non-dir/non-empty); all ambiguous/mutating states keep snapshots. Extended check script to strict-by-default S1+S1b gates plus 6-case S2 rollback matrix (missing/file+0600/directory/symlink/rmdir-acting/mkdir-new). No-op copies 202023B x3 runs to zero; rollback preserved. No global confirmation cleanup (Sprint 2); no HARN-02-07/lock/state.ts changes.
- Validation: node scripts/check-operation-snapshots.mjs strict PASS exit 0 (gate 0/0/0)
- Validation: npm run check:operation-snapshots PASS exit 0
- Validation: npm run typecheck PASS
- Validation: npm run build PASS
- Validation: npm run check:adapters PASS (pipeline rollback consumer regression)
- Files changed: `src/cli/pipeline/operation-steps.ts`, `scripts/check-operation-snapshots.mjs`

**Verdict**: pass

---

## Unfinished work

_None — every task is done with a passing verdict._

## Learnings

- No-op mkdir/rmdir-if-empty sin copia: las operaciones determinadas sin efecto ya no crean snapshots recursivos de directorios.
- Matriz rollback 6/6 preservada para operaciones mutadoras (ausencias, ficheros, directorios, symlinks, permisos): politica conservadora ante duda.
- Gate 0/0/0 en validacion del area tocada: sin regresiones en el alcance verificado.
- Limpieza global diferida a Sprint 2 por alcance: backups retenidos hasta confirmacion total y limpieza tras exito/rollback en este sprint.
- QA APPROVED WITH NOTES con notas menores no bloqueantes, registradas en handoff.

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 2

- Sprint 2: implementar limpieza global diferida de temporales residuales con evidencia comparativa tiempo/bytes/backups antes-despues (R5).
- Medir ahorro cuantitativo reproducible de instalacion repetida antes de prometerlo (spec R5 should).
