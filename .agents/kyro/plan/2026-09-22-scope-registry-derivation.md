---
docType: plan
date: 2026-09-22
slug: scope-registry-derivation
title: Derivar scopes desde disco y eliminar contencion Git en project.json
maturedFrom: mature
agents: []
---

# Derivar scopes desde disco y eliminar contencion Git en project.json

## Core thesis

Eliminar la colision Git entre scopes distintos moviendo la autoridad de identidad/estado a `scopes/*/sprint.json` y sacando `scopes[]` del contrato compartido commiteado, de modo que el trabajo paralelo solo agregue archivos en carpetas distintas y ningun comando sobre un scope valido toque metadatos compartidos de otro.

## Problem / Motivation

Causa: cada alta o cambio de estado escribe el mismo array `scopes[]` en `.agents/kyro/project.json`, reescribiendo el documento entero aunque solo cambie un scope. Dos personas en carpetas distintas colisionan en el mismo hunk. El lock actual solo serializa procesos dentro del mismo checkout, no entre clones ni commits concurrentes.

Consecuencia: friccion en cada integracion, merges manuales por `id` propensos a error, tentacion de resolver con `ours/theirs` a ciegas o `merge=union` que duplica IDs o acepta estados incompatibles. El caso concreto que lo dispara — scope visual en `active` mas nuevo scope de lectura en `planning` — debe conservar ambos, pero Git no puede inferirlo del JSON.

Por que ahora: el equipo va a trabajar en paralelo real (Jeff + autor) y la opcion de solo serializar por proceso no escala; hay que dejar evidencia decision-complete antes de `/kyro:forge`.

## Current-state evidence

Observado (trazable a fuente):

- `src/cli/types.ts:152-164` — `scopes[]` documentado como registry cache; `activeScope` ya es local en `local.json`.
- `src/cli/commands/repair.ts:28` — `sprint.json` es single source of truth del estado vivo del scope.
- Escritores hot-path que reescriben el archivo entero: `src/cli/commands/plan.ts:512-558` (registro + reconciliacion), `src/cli/commands/repair.ts:119-140` (reconciliacion), `src/cli/checkpoints/sprint-close.ts:567-586` (CAS), mas `scope-completion.ts`, `scope-reopen.ts`, `scope-retirement.ts`, `src/cli/repair/integrity-apply.ts:214-250`.
- `src/cli/state.ts` — `mergeProjectLayers`, `updateProjectStateLayers`, `sanitizeSharedForWrite`; distingue capa shared vs local pero `scopes` sigue en shared.
- `src/cli/core/scopes.ts:27-42` — `rehydrateScopesFromDisk` ya hace union sin clobber y ordena por `id`.
- `src/cli/project/reconcile.ts:86-90,171-180` — clasificacion `REGISTERED_ORPHAN` y `deriveFromSprint` con `deriveScopeStatus`.
- `src/cli/core/git-trackability.ts:10` — trackability exige commitear `project.json` y `scopes/`.
- `src/cli/checkpoints/scope-completion.ts:127-192` y `src/cli/checkpoints/scope-retirement.ts:270-390` — completion/retirement validan y persisten ambos lados con digest que hoy incluye el array global (hallazgo de Codex, veredicto `9b8063ef`).
- Validacion experta Codex `9b8063ef-b2bd-448d-8752-20ae60dc3e6f` (codex/gpt-5.6-terra, medium): confirma el cuello, rechaza D, relega B a transitorio corto, recomienda C con rediseno de contratos a digests por scope, y exige matriz de compatibilidad + 5 fases.

Hipotesis explicitas (no autoridad hasta validar en Forge):

- H1: escanear `scopes/*/sprint.json` por comando es aceptable para el volumen esperado (decenas de scopes); un cache local ignorado solo acelera. Validar con medicion en WS2.
- H2: ningun flujo externo depende de leer `scopes[]` commiteado sin tener las carpetas en disco. Validar via busqueda de consumidores en WS1.

## Who it's for

- Primarios: mantenedores de Kyro que implementaran el cambio; equipo paralelo (autor + Jeff) que necesita crear/avanzar scopes sin coordinar un registrador unico.
- Secundarios: release/QA que certifica no-rotura; futuros contribuidores que heredaran el contrato.
- Decisiones que este artefacto debe habilitar sin re-entrevista: direccion C vs B, alcance de migracion de contratos lifecycle, gate de version minima, matriz de aceptacion para INIT.

## What success looks like

Prueba positiva observable:

1. Dos clones agregan un scope distinto cada uno y hacen push/pull: Git auto-mergea sin conflicto manual en metadatos compartidos, y tras pull ambos scopes son visibles con orden deterministico por `id` (`visual=active` + `lectura=planning` conservados).
2. `git status --short` tras operar sobre un scope valido nunca muestra modificacion de metadatos compartidos atribuibles a otro scope.
3. `kyro doctor --artifacts` limpio, suites `check:lossless-checkpoints`, `check:layered-state`, `check:install-rehydrate` en verde, y checkpoints historicos siguen verificables sin reescritura.

Deteccion de falso exito:

- Desaparece el conflicto pero un `sprint.json` corrupto aparece como `planning`, un huerfano se borra en silencio, o un binario v4 viejo interpreta un workspace nuevo sin error explicito. Cualquiera de estos invalida el exito aunque no haya conflicto Git.

## Product laws / invariants

- I1: `sprint.json` por scope es autoridad de identidad/estado derivable; jamas inventar `planning` ante corrupto/ilegible (previene scopes fantasma validos).
- I2: ningun cache (commiteado o local ignorado) es autoridad; solo acelera (previene divergencia cache-vs-disco).
- I3: huerfano/corrupto jamas se borra ni oculta automaticamente; migra a evidencia historica explicita (previene perdida silenciosa).
- I4: compromisos lifecycle (close/completion/reopen/retire/integrity) son por scope afectado, nunca digest del array global (previene falsos diverged por cambios no relacionados).
- I5: listado derivado es deterministico ordenado por `id` (previene diffs fantasma).
- I6: checkpoints historicos permanecen legibles/verificables sin reescritura (previene invalidar historia).
- I7: binario incompatible con workspace nuevo falla cerrado con remedio de version minima, nunca malinterpreta (previene corrupcion por version cruzada).

## Observable success and failure guarantees

- Exito: crear/avanzar/cerrar un scope valido solo crea o modifica archivos bajo `scopes/<id>/`; `project.json` commiteado solo cambia ante `principles/conventions/team`.
- Vacio: workspace sin scopes en disco lista cero scopes, doctor lo informa como estado valido vacio, no como error de registry.
- Parcial: scopes validos listan normal aunque otro scope este corrupto; el corrupto aparece solo como diagnostico fail-closed con ruta y remedio.
- Dependencias degradadas: sin Git o sin red, lectura/validacion local sigue funcionando; sync es la unica operacion que requiere red/remoto.
- Entrada invalida: `sprint.json` invalido, id duplicado con contenido distinto, o identidad carpeta-vs-sprint en conflicto bloquean solo ese scope con error accionable.
- Fallo irrecuperable: corrupcion sin checkpoint utilizable se reporta como tal, sin mint ni borrado, con remedio de restauracion desde archive.

## Outcome-based scope

### In

- Lectura derivada de scopes desde disco con taxonomia fail-closed conservada (valido, corrupto, recuperable, danado, foreign).
- Contratos lifecycle e integrity migrados a digests por scope.
- `project.json` commiteado sin `scopes[]` canonico; `sync/install` solo reconstruye cache local ignorado.
- Matriz de compatibilidad + gate de version minima coordinada.
- Suites actualizadas y matriz de dos clones verde.

### Explicitly out

- Merge-driver Git custom o `merge=union`: rechazado por fragil (config por clon, no corre en merges web, no resuelve digests) — no se implementa.
- Registry por archivo `registry/<id>.json` commiteado: rechazado por duplicar `sprint.json` con igual churn y nueva copia derivada.
- Cambio de modelo de `sprint.json` o de roadmap/tasks: fuera de alcance; se conserva tal cual.
- Soporte a binario v4 viejo leyendo workspace nuevo sin actualizar: rechazado; se exige version minima con fallo explicito.

## Closed decisions with rationale

- D1 Direccion C (derivacion total) como estado final. Evidencia: cuello confirmado + SSOT ya es `sprint.json` + rehydrate union existente + validacion Codex. Tradeoff: mayor impacto (state, validacion, doctor, trackability, tests, migracion dual-read). Consecuencia: cero colision por scopes distintos.
- D2 B (hint commiteado solo-sync) solo como transitorio cortisimo opcional, no como solucion. Evidencia: Codex advierte invisibilidad semantica hasta sync + colision sync-vs-sync residual (caso Jeff). Tradeoff: baja churn pero no cumple requisito. Consecuencia: no presentarlo como estado final.
- D3 D rechazado. Evidencia: driver depende de config local y no decide semantica lifecycle; registry por archivo perpetua copia. Consecuencia: no se implementa.
- D4 `project.json` commiteado conserva solo `artifactRoot`, principios, convenciones, equipo; `scopes[]` sale del canonico compartido. Rationale: separa configuracion rara/serializable de registro contencioso. Tradeoff: cambio de contrato + migracion. Consecuencia: crear scope deja de tocar archivo compartido.
- D5 Lifecycle/integrity a pre/post imagenes y digests del scope afectado. Rationale: hallazgo Codex de `scope-completion.ts` y `scope-retirement.ts` atados al array global. Tradeoff: reescribir comparaciones CAS. Consecuencia: cambios no relacionados dejan de marcar diverged.
- D6 Compat con gate de version minima coordinada, sin retrocompat total silenciosa. Rationale: v4 viejo que exige `scopes[]` no puede interpretar workspace C con seguridad. Tradeoff: obliga a actualizar flota. Consecuencia: fallo explicito en vez de corrupcion.
- D7 Cache local ignorado solo perf, jamas autoridad. Rationale: evita segunda fuente de verdad. Consecuencia: lectura siempre verifica disco.
- D8 Disciplina operativa fase 0 hasta que C aterrice (un registrador, resto solo su carpeta, `pull --rebase` + `sync` + `doctor`, merge manual por `id`). Rationale: coste cero inmediato. Consecuencia: reduce colisiones sin pretender eliminarlas.

## Constraints and tradeoffs

- Compatibilidad: mantener forma v4 para `sprint.json` y checkpoints historicos; solo cambia contrato de `project.json` bajo gate versionado con dual-read transitorio y migracion explicita.
- Rendimiento: O(n) por escaneo de directorios, operacion ya existente; medir en WS2 antes de introducir cache.
- Seguridad/integridad: jamas auto-reparar mintiendo estado ni borrar huerfanos; checkpoints inmutables no se reescriben.
- Operativo: `trackability` seguira exigiendo `project.json` y `scopes/**`, pero no un array registry; actualizar diagnostico y remedio.
- Equipo/tiempo: el costo mayor esta en migrar contratos y fixtures, no en el lector derivado; no comprimirlo a un solo cambio.

## Risks, failure modes and degradation

- R1 Huerfano convertido en desaparicion: trigger `REGISTERED_ORPHAN` sin directorio. Impacto: perdida de historia. Prevencion: migrar a reconciliation record explicito. Senal: test de huerfano que exige evidencia, no lista vacia.
- R2 Corrupto mint como valido: trigger `CORRUPT_SPRINT`/invalido. Impacto: scope fantasma `planning`. Prevencion: taxonomia fail-closed conservada. Senal: test negativo que exige diagnostico, no fila.
- R3 Falso diverged por cambio no relacionado: trigger digest global. Impacto: bloquea close/retire legitimo. Prevencion: D5 digests por scope. Senal: test de concurrencia con cambio ajeno que debe pasar.
- R4 Binario viejo malinterpreta workspace nuevo: trigger version cruzada. Impacto: corrupcion silenciosa. Prevencion: D6 gate con fallo explicito. Senal: test de compat que exige error accionable.
- R5 Regresion perf: trigger escaneo por comando en repo grande. Impacto: CLI lento. Contencion: cache ignorado solo-lectura. Senal: benchmark WS2.
- R6 Churn de fixtures: trigger suites que asertan writes a `project.json` en close. Impacto: falsos rojos. Prevencion: actualizar a WS5 con criterios nuevos. Senal: diff de tests revisado como contrato, no como ruido.
- Residual aceptado: dos editores del mismo `id`/`sprint.json` o de `principles/conventions/team` seguiran colisionando — es conflicto correcto y debe seguir colisionando.

## Execution blueprint

- WS0 Disciplina fase 0 (ahora, sin codigo). Objetivo: bajar colisiones hoy. Insumos: flujo citado en conversacion. Entregables: regla de un registrador + solo-su-carpeta + `pull --rebase`/`sync`/`doctor`. Dependencias: ninguna. Gate: equipo la aplica en el conflicto actual (`visual` + `lectura` por `id`). Prueba: merge manual conserva ambos.
- WS1 Contratos y pruebas primero. Objetivo: declarar autoridad y compat. Insumos: `src/cli/types.ts`, `src/cli/state.ts`, `src/cli/project/reconcile.ts`, `artifacts/scopes.ts`. Entregables: declaracion `sprint.json` autoridad / `project.json` sin registry / `local.json` seleccion + matriz compat + test dos clones union deterministica. Gate: matriz aprobada. Prueba: test dos clones verde en rama.
- WS2 Lectura dual y diagnostico. Objetivo: lector derivado sin activar escritura. Insumos: `src/cli/core/scopes.ts`, `src/cli/project/reconcile.ts`, `src/cli/artifacts/scopes.ts`. Entregables: lector derivado ordenado por `id` + diagnosticos corruptos/recuperables/foreign + comparador vs legacy con remedio. Gate: paridad en workspaces sanos, diagnostico en danados. Prueba: benchmark + suite diagnostica.
- WS3 Migrar lifecycle. Objetivo: digests por scope. Insumos: `sprint-close.ts`, `scope-completion.ts`, `scope-reopen.ts`, `scope-retirement.ts`, `repair/integrity-apply.ts`, `commands/plan.ts`, `commands/repair.ts`. Entregables: CAS y checkpoints por scope, historicos legibles sin reescritura. Gate: concurrencia con cambio ajeno no marca diverged; corrupto no minta. Prueba: tests de carrera + negativos.
- WS4 Activar C con gate. Objetivo: quitar `scopes[]` canonico. Insumos: `src/cli/state.ts`, validacion shared, `artifact-doctor.ts`, `core/git-trackability.ts`, `install-plan.ts`. Entregables: `sync/install` solo cache local ignorado + schema/doctor/trackability actualizados + gate version minima. Gate: workspace nuevo sin registry valido en binario nuevo y rechazado explicito en viejo. Prueba: migracion dual-read + rechazo versionado.
- WS5 Endurecer y certificar. Objetivo: no-rotura verificada. Insumos: `check-lossless-checkpoints`, `check-layered-state`, `check-install-rehydrate`, status/fixtures. Entregables: suites adaptadas + corrupcion/huerfano/recovery/retire-interrumpido/compat-historica. Gate: todo verde + Codex re-valida. Prueba: reporte de certificacion.

## Acceptance and validation matrix

| Exito/invariante | Escenario | Evidencia requerida | Metodo |
|---|---|---|---|
| Union dos clones | `visual=active` + `lectura=planning` concurrentes | ambos visibles ordenados tras pull, sin edicion manual | test dos clones |
| Aislamiento por scope | operar scope X | `git status` sin metada compartida de Y | diff de status |
| I1 no mint | `sprint.json` corrupto | diagnostico fail-closed, cero fila valida | test negativo |
| I3 huerfano | fila sin directorio | reconciliation record, no borrado | test huerfano |
| I4 sin falso diverged | cambio ajeno concurrente | close/retire del scope objetivo pasa | test carrera |
| I6 historia | checkpoints viejos | verificables sin reescritura | check lossless |
| I7 version | binario viejo + workspace nuevo | error explicito version minima | test compat |
| Doctor/trackability | workspace C | `doctor --artifacts` limpio, trackability sin exigir array | CLI + checks |

## Forge handoff

- Objetivo de scope propuesto: implementar derivacion de scopes desde disco con contratos por scope y gate versionado, certificando cero colision por scopes distintos sin regresion.
- Requisitos candidatos: lector derivado dual; CAS/digests por scope en close/completion/reopen/retire/integrity; `project.json` sin registry canonico; cache local ignorado; schema/doctor/trackability actualizados; matriz dos clones + negativos + compat.
- No-objetivos: merge-driver, registry por archivo, cambios a modelo `sprint.json`, soporte silencioso de binario viejo.
- Dependencias: WS1 antes de todo codigo; WS2 antes de WS3; WS3 antes de WS4; WS5 cierra.
- Orden: WS0 inmediato en paralelo a WS1; luego WS2→WS3→WS4→WS5 estrictos.
- Seguimientos no bloqueantes: benchmark fino de escaneo y conveniencia de ordenar titulos en UI (no cambia contrato).

## Quality gate

Scores: thesis 14/15, grounding 14/15, clarity 13/15, outcomes 13/15, invariants 9/10, decisions 9/10, scope 9/10, handoff 9/10. Total 90/100. Fuentes: conversacion (diagnostico, objecion Jeff, opciones A-D), fuentes citadas en Current-state evidence, informe Codex `9b8063ef`. Sin contradicciones materiales abiertas; residual mismo-id/mismo-archivo/principios declarado como conflicto correcto.
