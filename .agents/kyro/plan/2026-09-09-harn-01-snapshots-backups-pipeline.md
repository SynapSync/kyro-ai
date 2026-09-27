---
docType: plan
date: 2026-09-09
slug: harn-01-snapshots-backups-pipeline
title: HARN-01 — Eliminar snapshots completos innecesarios y limpiar backups del pipeline
maturedFrom: mature
agents: []
---

# HARN-01 — Eliminar snapshots completos innecesarios y limpiar backups del pipeline

## Core thesis

La confianza operativa del pipeline de instalación exige no pagar copias recursivas por operaciones que no mutan nada y no acumular temporales en el camino de éxito: cada `mkdir` sobre un directorio existente debe ejecutarse sin `cpSync`, y cada transacción confirmada o revertida debe terminar sin backups `kyro-pipeline-*` residuales, porque el trabajo proporcional al directorio copiado y la acumulación silenciosa penalizan precisamente las instalaciones repetidas que deberían ser idempotentes y baratas.

## Problem / Motivation

Cada operación del pipeline toma un snapshot antes de ejecutarse. Cuando el destino es un directorio existente, `snapshotTarget` lo copia completo mediante `cpSync` recursivo a un temporal `kyro-pipeline-*`, incluso para un `mkdir` que con `mkdirSync(recursive:true)` no cambiaría nada. Además, los backups solo se eliminan en la ruta de restauración durante el rollback de directorios; el camino de éxito no tiene hook de commit/dispose y nunca los libera.

Consecuencias: tiempo y espacio proporcionales al directorio copiado por cada operación sobre directorios, más acumulación de temporales en operaciones exitosas. El caso patológico es la instalación repetida, que re-ejecuta `mkdir` sobre `runtimeRoot`, `.agents/kyro` y artefactos ya existentes. El mecanismo está confirmado por código en el HEAD actual; su impacto real en disco y latencia no se cuantificó (límite honesto heredado del TODO de auditoría), por lo que la medición antes/después forma parte del trabajo futuro en lugar de afirmarse por adelantado. Importa ahora porque HARN-01 es, junto a HARN-02, el primer paso del orden recomendado (eliminar trabajo innecesario antes de instrumentar o paralelizar nada).

## Current-state evidence

Hechos observados (HEAD `8c85c4da8f4c4a79b3792004aef4b5767c8e8967`):

- **E1 — Snapshot incondicional antes de aplicar.** `src/cli/pipeline/operation-steps.ts:78` — `OperationStep.run()` llama `snapshotTarget(target)` antes de `applyOperation`, para toda acción sin distinción. Fuente: lectura directa del fichero.
- **E2 — Snapshot de directorio = copia recursiva en tmp.** `src/cli/pipeline/operation-steps.ts:153–164` — si `lstatSync` indica directorio: `mkdtempSync(join(tmpdir(), 'kyro-pipeline-'))` + `cpSync(target, backupPath, { recursive: true, verbatimSymlinks: true })`. Coste proporcional al contenido copiado.
- **E3 — `mkdir` idempotente sin mutación sobre existente.** `src/cli/pipeline/operation-steps.ts:92–93` — `mkdirSync(target, { recursive: true })`. Sobre directorio existente no cambia contenido; el snapshot previo es trabajo perdido. Derivado por inspección causal, no supuesto.
- **E4 — Sin limpieza en éxito; limpieza solo en rollback de directorio.** `src/cli/pipeline/operation-steps.ts:169–184` (`restoreTarget`) elimina `dirname(backupPath)` solo tras restaurar un directorio. `src/cli/pipeline/orchestrator.ts` (`execute`/`runStage`/`rollback`) no expone ni invoca ningún hook de commit/dispose: en éxito retorna sin liberar backups. Confirmado por ausencia de llamada.
- **E5 — Instalaciones repetidas pisan directorios existentes.** `src/cli/install-plan.ts:88–89,108–109` — el plan incluye `{ remove, mkdir } runtimeRoot` y `{ mkdir } KYRO_PROJECT_ROOT, ARTIFACT_ROOT`. Reinstalar = `mkdir` sobre existente = dispara E2+E3.
- **E6 — Tipos de operación base para la política por acción.** `src/cli/types.ts:781–791` (`OperationPlan.action`: `write | copy | mkdir | remove | rmdir-if-empty | upsert-block | remove-block | merge-json | remove-json-key`).
- **E7 — Punto de aplicación.** `src/cli/fs.ts:10,14` — `applyPlan` delega en `applyOperationPlan`; el cambio queda contenido en el pipeline sin tocar resolvedores de rutas.
- **E8 — Límite de cuantificación.** `.agents/kyro/harness-improvements.todo.md` (sección HARN-01): mecanismo confirmado por código; bytes/latencia no medidos. Las referencias de línea del TODO corresponden a su checkout y pueden haberse desplazado; las líneas citadas arriba se re-verificaron en el HEAD actual.
- **E9 — Sin check dedicado localizado.** Búsqueda de `snapshotTarget|kyro-pipeline-|OperationStep` solo da resultados en `src/cli/pipeline/` y `src/cli/fs.ts`; en `scripts/` no se localizó un check dedicado a snapshots del pipeline. Se registra como cobertura no encontrada, no como ausencia absoluta.

Hipótesis explícitas (no hechos): el coste duele en instalaciones repetidas (H1); un fallo de `cpSync` a mitad de snapshot podría dejar el `mkdtemp` huérfano (H2); el hook de limpieza admite dos formas (dispose por paso + barrido final, o callback del orquestador) y ambas satisfacen la invariante (H3, decisión de implementación para forge).

## Who it's for

- **Usuarios primarios:** mantenedores de Kyro y consumidores del pipeline de instalación/sync que reinstalan con frecuencia y necesitan instalaciones idempotentes, rápidas y sin basura en tmp. Situación: re-ejecución sobre workspace ya instalado. Decisión que este artefacto debe habilitar: aprobar un scope que cambie la política de snapshots y limpieza sin debilitar el rollback.
- **Stakeholders secundarios:** agentes/operadores que diagnostican instalaciones (necesitan distinguir basura del pipeline de evidencia útil); futuros trabajos HARN-02–HARN-07 (necesitan que HARN-01 no cambie sus contratos: ni atomicidad de estado, ni contexto, ni trazas, ni arranque).

## What success looks like

Resultados observables y falsables:

- **S1 — `mkdir` sobre directorio existente sin copia recursiva.** Prueba: fixture con directorio existente con contenido; cero invocaciones de copia recursiva y directorio intacto. Falso éxito detectado si el tiempo baja pero el contador de copias no es cero.
- **S2 — Éxito sin backups residuales.** Prueba: plan con `mkdir`+`write`+`copy` exitoso deja cero directorios `kyro-pipeline-*` nuevos en `tmpdir()`. Falso éxito detectado si mejora el tiempo pero el listado de tmp muestra residuales (“rápido pero sucio”).
- **S3 — Rollback correcto y limpio.** Prueba: fallo inyectado tras N pasos exitosos restaura el estado previo y no deja backups salvo los declarados ante un rollback fallido. Falso éxito si el estado parece restaurado pero quedan temporales.
- **S4 — Medición comparativa.** Prueba: tabla antes/después en instalación repetida (tiempo, bytes copiados, nº de backups). Falso éxito si solo se reporta tiempo sin bytes ni conteo de residuales.

## Product laws / invariants

- **I1 — Nunca copiar un directorio para una operación sin efecto.** Previene pagar coste proporcional al contenido cuando `mkdir`/`rmdir-if-empty` no mutarán nada.
- **I2 — Rollback disponible hasta la confirmación total.** Previene perder recuperabilidad por borrar un backup antes del fin de la transacción.
- **I3 — Sin residuales tras confirmar o revertir.** Previene acumulación silenciosa en tmp en el camino de éxito y tras rollback limpio.
- **I4 — Un `mkdir` no-op no necesita rollback porque no mutó nada.** Previene complejidad fantasma (restaurar lo que nunca cambió) y justifica la ausencia de snapshot en ese caso.
- **I5 — Un fallo de snapshot no corrompe el target ni oculta el error.** Previene convertir un problema de backup en pérdida de datos o en éxito silencioso.
- **I6 — Tipo, contenido, modo y enlace se preservan en rollback.** Previene regresiones en ficheros, directorios, symlinks y ausencias (`missing`).

## Observable success and failure guarantees

- **Éxito:** aplica todo el plan; estado final igual al actual (mismo contenido, modos y enlaces donde corresponda); cero `kyro-pipeline-*` nuevos.
- **Estado vacío (`missing`):** operación sobre target inexistente funciona sin crear backup; rollback de ese paso es no-op (restaurar ausencia = eliminar lo creado).
- **Datos parciales:** `rmdir-if-empty` sobre inexistente, no-directorio o no-vacío no actúa y no deja backup; `mkdir` sobre existente no actúa y no deja backup.
- **Dependencia degradada (tmp lleno o `cpSync` fallido):** el paso falla con error propagado, el target queda intacto y no se deja huérfano salvo evidencia declarada para diagnóstico.
- **Entrada inválida:** `copy` sin `source`, `upsert/remove-block` sin `blockName`, `remove-json-key` sin `jsonPath` fallan antes de mutar, como hoy.
- **Fallo irrecuperable (apply + rollback fallan):** se reporta error compuesto apply+rollback (semántica actual de `formatPipelineError`/orquestador) y los backups retenidos se declaran como evidencia, nunca como basura silenciosa.

## Outcome-based scope

### In

- Política de snapshots específicos por operación: `mkdir` y `rmdir-if-empty` sin efecto no generan backup de directorio; el resto de acciones mantienen snapshot suficiente para rollback byte a byte.
- Limpieza explícita de backups al confirmar el plan, reteniéndolos hasta el fin de la transacción; revisión de la limpieza en fallos de snapshot y en rollback sin destruir evidencia necesaria para recuperación.
- Fixtures y medición antes/después en instalación repetida (tiempo, bytes copiados, residuales) más regresión de rollback por kind (`missing`, fichero, directorio, symlink, permisos).

### Explicitly out

- HARN-02 (publicación atómica de estado), HARN-03/04/05/06/07: se excluyen por instrucción de enfoque y porque el TODO los declara separables; añadirlos ocultaría el coste real de HARN-01.
- Cambios en estrategia de concurrencia o paralelismo: rechazados porque el propio TODO prohíbe basarlos en hipótesis no medidas.
- Cambios de semántica visible de `write/copy/remove/merge-json` más allá de su snapshot/limpieza.
- Promesas cuantitativas de ahorro antes de medir.

## Closed decisions with rationale

- **D1 — Lane `mature`, docType `plan`.** Rationale: referencia legible aportada + problema causal, éxito observable, límites, decisiones y evidencia sustantivos + compromiso de construcción. Tradeoff: exige handoff ejecutable sin re-entrevista. Consecuencia: el artefacto debe bastar para `forge`.
- **D2 — Alcance solo HARN-01.** Rationale: instrucción explícita + orden recomendado que separa HARN-01 de HARN-02. Tradeoff: se renuncia a sinergias con publicación atómica. Consecuencia: no tocar `state.ts`, locks ni escritura durable.
- **D3 — Snapshots específicos por operación; `mkdir`/`rmdir-if-empty` sin efecto no copian.** Rationale: E2+E3 prueban desperdicio cierto. Tradeoff aceptado: esos no-ops quedan sin rollback a cambio de eliminar el `cpSync` recursivo. Consecuencia: definir “sin efecto” operacionalmente (existe + es directorio; `rmdir-if-empty` no actúa si no existe, no es directorio o no está vacío).
- **D4 — Limpieza al confirmar, reteniendo hasta fin de transacción.** Rationale: propuesta HARN-01 + invariante I2. Tradeoff: pico de disco durante el plan a cambio de recuperabilidad total. Consecuencia: éxito y rollback limpio terminan sin residuales.
- **D5 — Medición como parte del scope, no como afirmación previa.** Rationale: E8 (sin cuantificación). Tradeoff: el primer workstream mide sin cambiar código. Consecuencia: el éxito exige números, no solo percepción.

## Constraints and tradeoffs

- **Compatibilidad:** preservar semántica de rollback para `write/copy/remove/upsert/merge-json`, incluyendo symlinks (`verbatimSymlinks`), modos de fichero y caso `missing`. Fuente: `operation-steps.ts:153–184`.
- **Rendimiento:** el objetivo es eliminar trabajo (no copiar) y basura (limpiar), no acelerar copias ni paralelizar. Sin benchmarks previos, el primer entregable es la medición.
- **Seguridad/integridad:** no borrar evidencia necesaria cuando el rollback mismo falla; declarar lo retenido.
- **Operativa:** los temporales viven en `tmpdir()` del SO; el barrido debe identificar solo los propios (`kyro-pipeline-*` creados por el plan) y nunca tmp ajeno.
- **Límite de diseño:** dos formas de hook (dispose por paso + barrido final, o callback commit en el orquestador) satisfacen D4; la elección se delega a forge como hipótesis H3 para no inventar una decisión de arquitectura aquí.

## Risks, failure modes and degradation

- **R1 — Definir mal “sin efecto” y saltarse un snapshot necesario.** Trigger: `mkdir` donde el path existe pero no es directorio, o condición de carrera. Impacto: mutación sin rollback. Prevención: comprobar `existsSync + lstatSync.isDirectory()` en el momento del snapshot; ante duda, snapshot conservador. Señal: test de regresión por kind en rojo.
- **R2 — Borrar un backup antes del commit y perder rollback.** Trigger: dispose por paso demasiado ansioso. Impacto: fallo tardío irrecuperable. Contención: I2 (retener hasta confirmación total). Señal: fallo inyectado tardío no restaura.
- **R3 — Fallo de `cpSync` deja huérfano o corrompe.** Trigger: tmp lleno o permiso. Impacto: basura o, peor, target dañado. Prevención: snapshot no muta el target; fallo propaga con target intacto y limpieza documentada. Señal: inyección en `cpSync` deja target intacto.
- **R4 — Barrido over-broad borra tmp ajeno.** Trigger: patrón de limpieza demasiado amplio. Impacto: pérdida de datos de otros procesos. Prevención: registrar rutas exactas creadas por el plan y borrar solo esas. Señal: auditoría de rutas borradas.
- **R5 — Medición no representativa.** Trigger: fixture trivial (dir vacío). Impacto: sobrestimar el ahorro. Prevención: fixture con contenido realista + instalación repetida real. Señal: bytes copiados “antes” cercanos a cero invalidan la muestra.

## Execution blueprint

- **WS1 — Baseline y reproducción (sin cambio de código).** Objetivo: fijar el “antes” honesto. Inputs: E1–E5, E8. Entregables: fixture `mkdir` sobre directorio existente con contador de copias; script de instalación repetida que mide tiempo, bytes copiados y lista `kyro-pipeline-*` residuales en éxito y en rollback. Dependencias: ninguna. Gate: medición “antes” reproducible y fixture en rojo (copia detectada, residuales detectados).
- **WS2 — Snapshots específicos por operación.** Objetivo: no copiar directorios para no-ops. Inputs: `src/cli/pipeline/operation-steps.ts:58–86,153–164`, `src/cli/types.ts:781–791`. Entregables: política por acción + predicado “sin efecto” + tests por kind. Dependencias: WS1. Gate: A1 en verde; rollback del resto byte a byte (A4).
- **WS3 — Limpieza explícita en confirmación y en fallos.** Objetivo: cero residuales sin perder recuperabilidad. Inputs: `src/cli/pipeline/orchestrator.ts` (`execute`), `src/cli/pipeline/operation-steps.ts:169–184`. Entregables: dispose/commit por paso + barrido final solo de rutas registradas + manejo de fallo de snapshot y de rollback fallido con evidencia declarada. Dependencias: WS2 (el modelo de snapshot debe existir antes de decidir cuándo borrar). Gate: A2, A3, A5 en verde.
- **WS4 — Validación comparativa y regresión.** Objetivo: probar el “después”. Inputs: salidas WS1–WS3. Entregables: tabla antes/después + suite de regresión (file/dir/symlink/missing/permisos) + instalación repetida idempotente. Dependencias: WS3. Gate: matriz de aceptación completa en verde.

## Acceptance and validation matrix

| # | Outcome / invariante | Escenario | Evidencia requerida | Método |
| --- | --- | --- | --- | --- |
| A1 | S1 + I1 + I4 | `mkdir` sobre directorio existente con contenido | cero copias recursivas; directorio intacto | fixture + espía/contador de IO |
| A2 | S2 + I3 | plan `mkdir`+`write`+`copy` exitoso | cero `kyro-pipeline-*` nuevos en `tmpdir()` | listado tmp antes/después |
| A3 | S3 + I2 + I3 | fallo inyectado tras N éxitos | estado restaurado; cero backups salvo rollback fallido declarado | fallo inyectado + diff de estado |
| A4 | I6 | rollback por kind: `missing`, fichero, directorio, symlink, permisos | contenido, modo y enlace idénticos | fixtures por kind |
| A5 | I5 | `cpSync` falla a mitad de snapshot | error propagado; target intacto; sin huérfano o huérfano declarado | inyección en `cpSync` |
| A6 | S4 | instalación repetida real | tabla tiempo + bytes + nº backups antes/después | benchmark WS1 vs WS4 |

## Forge handoff

- **Objetivo del scope propuesto:** eliminar los snapshots completos de directorio para operaciones sin efecto y limpiar los backups temporales del pipeline en confirmación y rollback, con medición antes/después en instalación repetida.
- **Candidatos a requisito:** (1) `mkdir`/`rmdir-if-empty` sin efecto no generan backup; (2) resto de acciones preserva rollback actual; (3) commit/dispose explícito libera solo rutas registradas por el plan; (4) fallo de snapshot no muta el target; (5) rollback fallido declara evidencia retenida; (6) tabla comparativa obligatoria.
- **No-goals:** HARN-02–HARN-07, paralelismo, cambios de semántica visible fuera de snapshot/limpieza.
- **Dependencias y orden:** WS1 → WS2 → WS3 → WS4; WS2 y WS3 separados a propósito.
- **Seguimiento no bloqueante:** elección del hook exacto (dispose por paso + barrido final vs callback commit en el orquestador) — hipótesis H3 para decidir en forge sin cambiar aceptación.

## Quality gate

Scores: tesis 13/15, grounding 14/15, claridad 13/15, outcomes 14/15, invariantes 9/10, decisiones 9/10, alcance 10/10, handoff 10/10. **Total 92/100.** Fuentes revisadas: `.agents/kyro/harness-improvements.todo.md` (HARN-01), `src/cli/pipeline/operation-steps.ts`, `src/cli/pipeline/orchestrator.ts`, `src/cli/pipeline/types.ts`, `src/cli/install-plan.ts`, `src/cli/fs.ts`, `src/cli/types.ts`, búsqueda en `scripts/`. Sin contradicciones materiales abiertas; hipótesis H1–H3 marcadas como tales.
