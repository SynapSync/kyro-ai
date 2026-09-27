---
docType: plan
date: 2026-09-26
slug: organic-work
title: Kyro Work — camino alternativo de ejecución
maturedFrom: mature
agents: []
---

# Kyro Work — camino alternativo de ejecución

## Core thesis

Kyro necesita un segundo camino de ejecución que el usuario pueda elegir explícitamente para cualquier plan. Kyro Work, expuesto como `/kyro:work` y `kyro work`, convierte un brief en tareas verificables que pueden evolucionar con decisiones registradas, sin imponer el ciclo scope/sprint de Forge. La confianza del camino depende de que el CLI sea el único escritor de su estado, de que toda revisión se invalide cuando cambia su objeto, y de que Forge conserve sus contratos y artefactos actuales.

## Problem / Motivation

`/kyro:idea` ya entrega un plan que puede servir como handoff directo, pero ese handoff no ofrece un estado persistente y gobernado para ejecutar varias tareas sin abrir scope y sprint. Forge sí ofrece planificación, context packs, evidencia, revisión y recuperación, pero su ciclo está definido alrededor de `project.json`, `local.json`, `scopes/{scope}/sprint.json`, sprints y cierre. El usuario quiere elegir otro método de trabajo, no una clasificación automática de complejidad: un trabajo grande, largo o incierto puede ser Work si así lo invoca.

El riesgo de resolverlo como una variante implícita de Forge es alterar rutas, estados o garantías de trabajos existentes. El riesgo de permitir JSON editado por un agente es crear tareas o aprobaciones que el CLI no pueda validar. El resultado deseado es una vía explícita, autónoma y compatible que pueda, más adelante, entregar trabajo pendiente a Forge mediante una promoción deliberada.

## Current-state evidence

1. Decisión del usuario en esta conversación: Work y Forge son caminos distintos disponibles para cualquier plan; Work se activa sólo por invocación explícita. Work → Forge es una convergencia futura deseada. Esta decisión reemplaza la caracterización previa de Work como opción sólo para trabajos sencillos o cortos.
2. `commands/idea.md:8-12` declara que Idea produce un artefacto pre-scope y puede servir como handoff; prohíbe leer o modificar estado de scope. `internal/skills/seedbed/assets/templates/matured-idea.md:12-80` ya incluye tesis, evidencia, límites, decisiones, blueprint y matriz de aceptación.
3. `commands/forge.md:12-52` enruta Forge a partir de capas de proyecto, integridad y `context-pack`; todos los cambios de estado gobernado pasan por verbos CLI. Esta ruta es contrato existente, no punto de entrada automático de Work.
4. `src/cli/app.ts:35-207` centraliza el despacho CLI y clasifica invocaciones mutantes para bloqueo de escritor. `src/cli/pipeline/state-writer-lock.ts:71-100` contiene una validación de ruta administrada que rechaza escape del workspace y symlinks; la implementación Work debe utilizarla y cubrirla con regresiones.
5. `src/cli/types.ts:220-231,443-477,508-522` define estado de tarea, evidencia, veredicto y dependencias. `docs/maker-checker.md:1-110` describe cobertura de criterios, invalidez de aprobaciones obsoletas y propiedad CLI de evidencia y veredicto. Son patrones útiles, pero los nuevos tipos Work deben tener semántica propia y no heredar campos de sprint/deuda por accidente.
6. `src/cli/commands/context-pack.ts:46-145` muestra la ventaja de leer un paquete pequeño para retomar trabajo. Work requiere un `work context-pack` específico que no resuelva un scope ni lea capas de proyecto.
7. `.gitignore:15-22` excluye `.agents/kyro/*` salvo excepciones explícitas; por tanto `.agents/kyro/work/` necesita una excepción y pruebas de trackability antes de considerarse persistente en Git.

Estas son observaciones del checkout local del 26 de septiembre de 2026. Las rutas y líneas deben revalidarse al implementar; este documento define el contrato de producto, no certifica una implementación aún inexistente.

## Who it's for

- Usuario que ya tiene una idea o plan y elige Work por su modo de ejecución, con independencia del tamaño, duración o dificultad.
- Agente implementador que necesita una tarea delimitada, contexto y una receta CLI para registrar resultados sin editar estado manualmente.
- Agente o humano revisor que necesita criterios, evidencia vigente y un veredicto trazable.
- Mantenedor de Kyro que debe poder actualizar, instalar y diagnosticar Work sin modificar el comportamiento de Forge.

## What success looks like

1. Un usuario invoca `/kyro:work <referencia o descripción>` y puede crear, planificar, ejecutar, revisar, replanificar y cerrar un Work sin crear scope ni sprint. La prueba incluye un plan con múltiples tareas y dependencias; no hay límite de complejidad o duración impuesto por el producto.
2. Cada transición de `work.json` sale de un verbo CLI validado. El agente entrega entradas temporales estructuradas o flags; nunca escribe el archivo administrado directamente. Un JSON con clave desconocida, referencia rota, estado imposible, digest obsoleto o ruta insegura es rechazado con diagnóstico preciso.
3. Después de cerrar/reabrir una sesión, `kyro work context-pack --work <id> --json` ofrece la acción siguiente, tarea elegible, aceptación, dependencias, bloqueos y recetas CLI desde el estado persistido. No necesita leer un scope.
4. Una tarea sólo queda `verified` tras evidencia y revisión `pass` de todos los criterios vigentes. Cambiar brief, definición, dependencias o evidencia invalida el veredicto afectado antes de permitir ejecución/cierre.
5. Las pruebas de Forge previas siguen pasando y pruebas nuevas demuestran que cada verbo Work deja byte a byte intactos `project.json`, `local.json` y todos los `sprint.json` preexistentes. Los comandos Forge no descubren ni enrutan Work de forma implícita.
6. La promoción Work → Forge se prepara y confirma de forma explícita, preserva origen y destino, transfiere sólo material válido pendiente y nunca declara como certificada una tarea sólo porque Work la verificó. La primera entrega puede dejar la promoción como fase posterior, pero el esquema y las pruebas de compatibilidad deben reservar su contrato desde v1.
7. `git check-ignore` y una prueba de dos clones demuestran que dos Work distintos no compiten por un registro global Work; conflictos sobre el mismo ID se detectan y fallan de forma explícita.

## Product laws / invariants

1. **Selección explícita.** Sólo una invocación Work crea/continúa Work. Idea no activa Work; Forge no lo adopta según tamaño, idioma o estado. Evita sorpresas y cambios de ruta de trabajos actuales.
2. **Sin límite de escala por política.** Work puede organizar cualquier plan. La decisión de usar Forge corresponde al usuario; las recomendaciones no bloquean Work. Evita clasificar erróneamente trabajos grandes como incompatibles.
3. **Estado aislado.** `work.json` vive bajo `.agents/kyro/work/<id>/`; no escribe `project.json`, `local.json`, `scopes[]`, `activeScope`, `sprint.json`, deuda, archivo o checkpoints de Forge. Evita corrupción cruzada y contención del registro global.
4. **Un solo escritor.** CLI valida el documento completo, las precondiciones, su revisión/digest y la transición antes de escritura atómica. Un agente no repara ni edita manualmente `work.json`. Evita estados aparentes que no provienen de una operación válida.
5. **Aprobación ligada al material.** Un `pass` referencia una revisión y digest de tarea, evidencia y brief que fueron revisados. Cualquier cambio material deja ese `pass` sin autoridad. Evita éxito falso tras replanificación.
6. **Verdad de dependencias.** Una tarea dependiente sólo está lista cuando cada prerequisito se verificó o existe una decisión explícita de cambio de dependencia. Una tarea bloqueada no autoriza a sus dependientes. Evita ejecución fuera de orden.
7. **Evidencia honesta.** Comandos, archivos, resultados y límites se registran como observados. Validación omitida o fallida no se convierte en `pass` por rellenar el esquema. Evita aprobación sólo estructural.
8. **Historial trazable.** Cambios de plan, anulaciones, bloqueos, cierres y promociones tienen actor, tiempo, motivo y revisión. Un cierre parcial exige disposición explícita por tarea. Evita que trabajo pendiente desaparezca.
9. **Rutas confinadas.** ID y referencias son segmentos seguros; se rechazan symlinks, escape, archivos ajenos, colisiones y escrituras fuera del workspace. Evita efectos fuera del proyecto.
10. **Lectura compatible, escritura estricta.** Versiones futuras pueden leer mediante migración explícita; ningún lector compatible autoriza a reescribir una forma que no entiende. Evita pérdida silenciosa de campos.

## Observable success and failure guarantees

- **Éxito:** `create` materializa brief y estado validado, `plan` añade tareas, `context-pack` enruta, `record-evidence` y `review` producen una secuencia válida, y `close` registra resultado y razón. Cada comando puede emitir JSON legible por agentes.
- **Estado vacío:** un Work recién creado con `tasks: []` es `draft`, `nextAction: plan_tasks`; nunca informa `done`. Un brief de Idea sin decisiones suficientes bloquea creación con los campos faltantes.
- **Datos parciales:** una tarea con evidencia y sin revisión es `awaiting_review`; una tarea bloqueada mantiene razón; las tareas independientes siguen disponibles. El estado de grupo se deriva y no oculta trabajo pendiente.
- **Dependencia degradada:** si un archivo de referencia desaparece o cambia digest, lectura y mutaciones materiales fallan con diagnóstico; `status` puede mostrar un estado degradado sólo si no lo presenta como verificable.
- **Entrada inválida:** claves desconocidas, IDs duplicados, ciclos, dependencias inexistentes, fecha/digest mal formado y transición prohibida dan error sin escritura parcial.
- **Fallo irrecuperable:** corrupción de `work.json`, colisión de ID o conflicto de revisión detiene mutaciones. Reparación, si se añade, debe ser un verbo explícito con preview y respaldo; jamás sintetiza un Work vacío encima de evidencia dañada.
- **Promoción interrumpida:** un fallo entre preparación y creación de scope deja una intención recuperable y ningún estado que finja promoción exitosa; se usan comprobación de digest, idempotencia y compensación/rollback donde el contrato lo permita.

## Outcome-based scope

### In

- Nuevo camino Work invocado con `/kyro:work` y CLI `kyro work`, disponible para cualquier plan sin heurística de complejidad.
- Brief de ejecución legible y vinculado a la Idea original por ruta y SHA-256; puede partir de una Idea o de una descripción suficiente y debe conservar problema, resultado, alcance, exclusiones, decisiones, invariantes, riesgos y matriz de aceptación.
- Esquema exacto `work.json` v1, comandos propietarios de todas sus mutaciones, lectura/status/context pack y validadores deterministas.
- Ciclo de tareas con dependencias, evidencia, revisión, cambio de plan, bloqueo, cancelación/sustitución explícita y cierre honesto.
- Integración de empaquetado/proyección de skills y comandos a hosts existentes; pruebas de instalación, actualización, ayuda y trackability Git.
- Diseño y entrega de promoción explícita Work → Forge tras estabilizar ambos contratos; no es requisito del primer sprint si compromete aislamiento o atomicidad.
- Pruebas de aislamiento frente a Forge, concurrencia, rutas inseguras, recuperación y compatibilidad.

### Explicitly out

- Sustituir Forge o cambiar su enrutamiento, esquema `sprint.json`, operaciones de QA, política de cierre o semántica de scopes.
- Convertir automáticamente Work en Forge, migrar Forge → Work o compartir estados vivos entre ambos caminos.
- Imponer número máximo de tareas, tiempo, archivos o dificultad. Se permiten límites técnicos razonables de tamaño de entrada/archivo con errores claros, no límites de tipo de trabajo.
- Llamar certificación independiente a un `pass` de revisión de tarea. QA integral es una capacidad distinta que podrá integrarse explícitamente más adelante.
- Persistir transcript, prompts completos, secretos, datos crudos de herramientas o caches dentro de `work.json`.
- Lanzar agentes delegados por defecto; una futura delegación debe ser opt-in y conservar al CLI como escritor.

## Closed decisions with rationale

| Decisión | Razonamiento y evidencia | Coste aceptado / consecuencia |
| --- | --- | --- |
| Work vive en Kyro AI como camino y CLI propios | Reutiliza instalación, adaptadores y conceptos de tarea existentes sin otra distribución | Añade comandos y pruebas al paquete; requiere proteger Forge con regresiones |
| El usuario elige Work o Forge en cada inicio | Decisión explícita del usuario; complejidad no determina método | La documentación debe explicar diferencias y no hacer auto-routing |
| Artefactos por ID bajo `.agents/kyro/work/` | Aísla escrituras por trabajo y permite seguimiento Git | Necesita excepción `.gitignore`, descubrimiento seguro e IDs sin colisión |
| `brief.md` porta intención; `work.json` porta estado | Idea ya produce un documento narrativo; ejecución necesita estado formal | CLI debe ligar ambos por digest y gestionar enmiendas |
| Toda escritura JSON es del CLI | Es requisito expreso y coincide con patrón `record-evidence`/`review` | Habrá más verbos y validadores; jamás se propone edición manual como recuperación |
| Context pack Work separado | El contexto Forge consulta scope/proyecto; Work no debe hacerlo | Se implementa otro read model pequeño, compartiendo sólo utilidades neutrales |
| Revisión por criterios y digest | El modelo actual identifica aprobación obsoleta; Work debe conservar esa garantía | Cambios materiales reabren trabajo y exigen nueva revisión |
| Promoción explícita y de una dirección en v1 | Permite convergencia sin prometer equivalencia semántica de estados | Requiere mapeo y transacción cuidadosa; no transfiere certificación automáticamente |

## Constraints and tradeoffs

- El documento es pre-scope; su escritura no modifica estado Kyro. La creación de scope/sprint de implementación sucede sólo después, mediante CLI Forge y autorización del usuario.
- El CLI Work debe usar validación de ruta y lock que garanticen confinamiento, rechazo de symlinks y serialización local. Un lock por checkout no sustituye resolución de conflictos entre clones; para el mismo Work se requieren `revision`/digest y conflictos explícitos.
- Las entradas `--from <file>` son propuestas temporales; el CLI debe validar forma, semántica y revisión esperada antes de materializar. El agente puede escribir esos archivos de entrada, pero no el `work.json` administrado.
- Ningún comando debe leer o cambiar estado Forge salvo `work promote`, que requiere preview, autorización final y una operación documentada sobre ambos contratos.
- El breve debe poder cambiar de modo controlado. Una enmienda crea una nueva revisión del contenido y reevalúa todas las tareas afectadas; no reescribe la historia de aprobación.
- El estado activo debe permanecer compacto. `activity` registra metadatos y razones breves; evidencia grande va a archivos externos referenciados por ruta/digest, con política de tamaño y secretos.
- Extensiones al esquema requieren incremento de versión y migración CLI explícita. v1 rechaza claves ajenas en escritura y cierra forma de todos los objetos definidos abajo.

## Canonical `work.json` v1 contract

Esta sección es normativa para la implementación. JSON usa UTF-8, timestamps ISO-8601 UTC, digest SHA-256 en hex minúscula de 64 caracteres, arrays en orden estable y `additionalProperties: false` en cada objeto. Campos requeridos siempre están presentes; cuando no hay valor se usa `null` o `[]` según se indica. No se admiten claves de scope/sprint como `activeSprint`, `scope`, `debt` o `targetSprint`.

### Raíz y referencias

| Campo | Tipo / valor inicial | Semántica y validador |
| --- | --- | --- |
| `schemaVersion` | entero `1` | Versión exacta del contrato; otra versión no se reescribe sin migración. |
| `kind` | literal `organic-work` | Evita confundirlo con `sprint.json`. |
| `id` | string slug no vacío | Segmento único seguro `[a-z0-9]+(?:-[a-z0-9]+)*`; coincide con directorio. |
| `title` | string no vacío | Nombre humano; no es identificador. |
| `objective` | string no vacío | Resultado verificable del Work, derivado del brief. |
| `brief` | objeto | `{path,digest,sourceIdea}`; forma exacta detallada abajo. |
| `state` | enum `draft\|active\|closed\|promoted`; inicial `draft` | Estado del Work, no de las tareas. `promoted` sólo tras destino confirmado. |
| `revision` | entero positivo; inicial `1` | Sube exactamente uno por mutación; precondición de concurrencia. |
| `createdAt` | timestamp CLI | Inmutable. |
| `updatedAt` | timestamp CLI | No anterior a `createdAt`; cambia con cada mutación. |
| `handoff` | objeto | Acción derivable y materializada atómicamente; validador comprueba consistencia. |
| `tasks` | array; inicial `[]` | IDs únicos, grafo acíclico, orden estable de alta. |
| `activity` | array; inicial `[]` | Eventos operativos compactos, monotónicos e inmutables. |
| `closure` | objeto o `null`; inicial `null` | Resultado explícito del cierre; sólo con estado `closed` o `promoted`. |
| `promotion` | objeto o `null`; inicial `null` | Enlace al scope destino; sólo con estado `promoted`. |

`brief` tiene exactamente `path` (relativo seguro, siempre `brief.md` bajo el Work), `digest` (SHA-256 del contenido exacto), `sourceIdea` (objeto o null). `sourceIdea`, cuando existe, tiene exactamente `path` (ruta relativa segura a documento Idea bajo `.agents/kyro/plan/`), `digest` (SHA-256 observado al crear) y `title` (string no vacío). El CLI verifica el digest antes de operaciones que dependen del contrato. Un archivo de Idea cambiado no altera automáticamente el brief ya aceptado.

`handoff` tiene exactamente `nextAction`, `nextTaskId`, `blockedReason`. `nextAction` es `plan_tasks`, `execute_task`, `review_task`, `resolve_blocker`, `ready_to_close` o `done`; `nextTaskId` es un ID existente o null; `blockedReason` es string no vacío o null. CLI deriva la próxima tarea determinísticamente según estado, dependencias y orden. Un lector debe rechazar un handoff que contradiga las tareas.

### Tarea y prueba

Cada objeto en `tasks[]` tiene exactamente los campos siguientes:

| Campo | Tipo / inicial | Regla |
| --- | --- | --- |
| `id` | `W1`, `W2`, ... | ID único, creciente y nunca reutilizado, aun si una tarea se cancela. |
| `title` | string no vacío | Nombre legible. |
| `description` | string no vacío | Entregable y comportamiento esperado. |
| `context` | string; puede ser `""` | Restricciones o evidencia relevante para ejecutor. |
| `filesToTouch` | string[]; puede ser `[]` | Guía, no whitelist; rutas relativas seguras, sin exigencia de conocer archivos antes de investigar. |
| `acceptanceCriteria` | string[] no vacío | Criterios observables, únicos tras normalización. |
| `dependsOn` | `Wn[]`; puede ser `[]` | IDs existentes, sin autodependencia ni ciclos. |
| `status` | enum `pending\|in_progress\|blocked\|awaiting_review\|verified\|cancelled\|superseded`; inicial `pending` | Estado explícito con transición validada. |
| `blocker` | objeto o null; inicial null | Motivo del bloqueo, actor y momento; sólo cuando `status=blocked`. |
| `evidence` | objeto o null; inicial null | Última evidencia vigente; historial previo queda en `activity` o adjunto referenciado. |
| `verdict` | objeto o null; inicial null | Último resultado de checker, ligado al material evaluado. |
| `disposition` | objeto o null; inicial null | Razón terminal de `cancelled`/`superseded`; no equivale a `verified`. |
| `definitionRevision` | entero positivo; inicial `1` | Sube al cambiar definición, criterios o dependencias. |

`blocker` tiene exactamente `reason` (string no vacío), `by` (string no vacío) y `recordedAt` (timestamp CLI). `disposition` tiene exactamente `kind` (`cancelled` o `superseded`), `reason`, `by`, `recordedAt` y `replacementTaskId` (ID existente o null; requerido no-null para `superseded`). La dependencia hacia tarea cancelada/sustituida bloquea hasta una actualización explícita; el CLI nunca la redirige silenciosamente.

`evidence` tiene exactamente `summary` (string no vacío), `validations` (array no vacío de objetos), `filesChanged` (rutas relativas seguras, `[]` permitido para tareas sólo documentales), `notes` (string o null), `by` (string), `recordedAt` (timestamp CLI), `definitionRevision` (entero) y `materialDigest` (SHA-256). Cada `validations[]` tiene exactamente `command` (string no vacío), `result` (`passed`, `failed` o `not_run`) y `note` (string o null). `not_run` y `failed` se muestran con honestidad; `review pass` exige pruebas suficientes para criterios vigentes, evaluadas por el checker, no sólo que el array exista. `materialDigest` liga brief digest y definición normalizada de la tarea; el CLI lo calcula, nunca acepta un valor fabricado por el agente.

`verdict` tiene exactamente `result` (`pass` o `fail`), `checkedCriteria` (array de criterios vigentes), `findings` (array), `by` (string), `reviewedAt` (timestamp CLI), `definitionRevision` (entero), `evidenceDigest` (SHA-256) y `reviewedMaterialDigest` (SHA-256). Cada `findings[]` tiene exactamente `severity` (`critical`, `warning`, `suggestion`) y `detail` (string no vacío). `pass` exige cobertura de todos los criterios, evidencia vigente, ausencia de finding crítico y separación maker/checker si la política lo exige. `fail` vuelve la tarea a `in_progress` con el finding retenido hasta evidencia nueva; un cambio de definición o brief invalida el veredicto antes de cualquier ruta siguiente.

`activity[]` tiene exactamente `seq` (entero consecutivo empezando en 1), `at` (timestamp CLI), `event` (enum `created`, `brief_amended`, `tasks_planned`, `task_started`, `task_blocked`, `task_unblocked`, `evidence_recorded`, `review_recorded`, `task_amended`, `task_disposed`, `work_closed`, `promotion_prepared`, `work_promoted`), `taskId` (`Wn` o null), `by` (string no vacío), `reason` (string no vacío) y `revision` (revisión posterior al evento). Una mutación puede añadir varios eventos a la misma revisión, pero `seq` es único y creciente. No se almacenan comandos completos, secretos ni transcript en eventos.

`closure`, cuando existe, tiene exactamente `outcome` (`completed`, `stopped`), `reason` (string no vacío), `by` (string), `closedAt` (timestamp CLI), `briefDigest` (SHA-256) y `finalRevision` (entero). `completed` exige todas las tareas `verified` o con disposición terminal explícita; el resumen muestra por separado verificadas y dispuestas. `stopped` admite pendientes/bloqueadas pero las enumera en la vista de cierre. Reabrir exige comando y razón explícitos, conserva la historia de cierre en `activity` y hace `closure=null`; si se necesita preservar metadatos completos de cierres anteriores, se añade un archivo histórico CLI-owned versionado antes de soportar reopen.

`promotion`, cuando existe, tiene exactamente `targetScope` (slug seguro), `targetPath` (ruta relativa del `sprint.json` destino), `sourceRevision` (entero), `sourceDigest` (SHA-256), `promotedTaskIds` (`Wn[]`, sólo tareas no verificadas y no dispuestas), `promotedAt` (timestamp CLI) y `by` (string). `promotion` sólo se escribe al comprobar que el scope destino registra un enlace recíproco verificable. Durante preparación, el estado sigue `active` o `closed` y `promotion=null`; la intención transaccional vive fuera de `work.json` hasta commit.

### Transiciones y verbos CLI

| Verbo propuesto | Entrada | Escritura y garantía |
| --- | --- | --- |
| `kyro work create --id <id> --from <idea-or-brief>` | referencia y slug; preview/dry-run | Genera `brief.md` y `work.json` v1 validados, en directorio nuevo; no sobrescribe existente. |
| `kyro work plan --work <id> --from <proposal.json> --expect-revision <n>` | array completo de tareas propuestas | Añade tareas/activa Work; previsualiza diff, valida dependencias y criterios, escritura atómica. |
| `kyro work status --work <id> --json` | ID | Sólo lectura; lista estado derivado y anomalías. |
| `kyro work context-pack --work <id> [--task Wn] --json` | ID/tarea | Sólo lectura; paquete pequeño, bloqueo, criterios, dependencias y recetas CLI; no lee estado Forge. |
| `kyro work start --work <id> --task Wn --expect-revision <n>` | tarea elegible | Marca `in_progress`; no altera dependencias. |
| `kyro work record-evidence --work <id> --task Wn ... --expect-revision <n>` | resultado real | Calcula digest y pasa a `awaiting_review`, o registra bloqueo con razón por `block`. |
| `kyro work review --work <id> --task Wn --verdict pass\|fail ... --expect-revision <n>` | cobertura y findings | Verifica evidencia/criterios/digest y marca `verified` o `in_progress`. |
| `kyro work amend-task --work <id> --task Wn --from <proposal.json> --expect-revision <n>` | cambio y razón | Preview, valida grafo y alcance, incrementa `definitionRevision`, invalida aprobaciones afectadas. |
| `kyro work amend-brief --work <id> --from <brief.md> --reason ... --expect-revision <n>` | brief completo | Preview del cambio, nuevo digest, invalida aprobaciones según impacto o todas si el impacto no puede probarse. |
| `kyro work dispose --work <id> --task Wn --kind cancelled\|superseded ...` | motivo y reemplazo si aplica | Sólo ruta explícita; no finge éxito ni desbloquea dependencias automáticamente. |
| `kyro work close --work <id> --outcome completed\|stopped --reason ...` | preview y confirmación | Cierre con lista de verificadas, dispuestas y pendientes; no crea checkpoint Forge. |
| `kyro work reopen --work <id> --reason ...` | preview y confirmación | Reabre cierre Work con historia conservada; prohibido después de promoción. |
| `kyro work promote --work <id> --to-scope <id>` | preview, digest y confirmación | Crea scope por interfaz Forge validada, registra vínculo recíproco y transfiere trabajo pendiente. Se entrega después del núcleo Work. |

Mutantes usan `--expect-revision`, bloqueo de escritor y persistencia atómica (archivo temporal en mismo directorio, fsync/rename según plataforma). `--dry-run` es estrictamente read-only. Las recetas en context pack usan la revisión actual, de modo que un agente con paquete obsoleto obtiene `REVISION_CONFLICT` y debe refrescar. Nunca se usa `--yes` para registrar evidencia; sólo para transiciones humanas irreversibles o de cierre según política. La implementación concreta de flags debe conservar estas garantías aunque ajuste nombres antes del primer release.

## Risks, failure modes and degradation

| Riesgo / disparador | Impacto | Contención y señal observable |
| --- | --- | --- |
| Un adaptador instala Work y sobrescribe comandos Forge | Regressión global | Proyección aditiva, manifest sincronizado, fixtures por host y comparación de rutas previas. |
| Dos agentes escriben mismo Work desde clones | Pérdida o conflicto Git | `revision`/digest + lock local, error de conflicto, prueba de dos clones; nunca merge automático de tareas aprobadas. |
| `brief.md` cambia sin CLI | Criterios ya no representan intención | Digest mismatch bloquea verificación/cierre; `amend-brief` es única reparación soportada. |
| Plan activo cambia tras `pass` | Aprobación obsoleta | Invalidación antes de escritura y tarea vuelve a ruta de revisión/ejecución; prueba de criterio y dependencia editados. |
| Evidencia declarada sin ejecutar validación | Falso éxito | Resultado explícito `not_run`, checker verifica criterios y reporta brecha; pruebas de fail. |
| Dependencia cancelada o cíclica | Ruta falsa o bloqueo permanente | Validador de grafo, disposición visible, actualización explícita de dependiente. |
| Symlink o path traversal | Escritura fuera de repo | Validación de segmento y ruta antes y durante transacción; fixture de symlink y carrera. |
| Activity crece sin límite | Contexto/coste | Context pack resumido; límite de tamaño y archivo histórico versionado si se requiere compactación, sin borrar eventos. |
| Promoción falla a mitad | Work y scope inconsistentes | Preview, commit en etapas con digest e idempotencia; `promotion=null` hasta enlace recíproco comprobado. |
| Integración global de doctor confunde Work con scope | Diagnóstico engañoso | `doctor --work` separado; `doctor --artifacts` conserva alcance actual hasta integración explícita. |

## Execution blueprint

1. **Contrato y pruebas de aislamiento.** Definir tipos/esquema v1 y fixtures válidos/inválidos para cada campo y transición; baseline de comandos Forge, proyecciones, instalación y archivos rastreados. Entregable: especificación ejecutable y matriz de no regresión. Gate: validación semántica completa y byte-equivalencia del estado Forge bajo comandos Work.
2. **Persistencia segura y lectura.** Implementar rutas Work confinadas, create, status y context pack, lock/revisión/atomicidad, brief digest y descubrimiento sin registro compartido. Gate: create idempotente por rechazo de colisión, symlink/traversal/JSON corrupto fail-closed, Work distintos independientes en dos clones.
3. **Planificación y vida de tarea.** Implementar plan, start, bloqueo, evidencia, review, dependencias y invalidación de aprobación. Gate: secuencia completa, revisión obsoleta rechazada, grafo cíclico/referencia rota fallan sin modificar archivo.
4. **Cambio orgánico y cierre.** Implementar enmienda de tarea/brief, disposición, cierre y recuperación/reopen con historia conservada. Gate: tarea modificada no conserva `pass`; cierre parcial enumera pendiente; ninguna tarea desaparece.
5. **Entrada pública y empaquetado.** Router `/kyro:work`, skill Kyro Work, adaptadores, `kyro --help`, manifests, sync/update y documentación de elección explícita. Gate: instalaciones limpias por host y suite Forge intacta.
6. **Promoción Work → Forge.** Diseñar contrato de traducción con destino recíproco, preview, transacción, idempotencia y recuperación; implementarlo sólo cuando el núcleo Work y el contrato Forge estén certificados. Gate: fallo inyectado en cada etapa no deja estado de promoción falso; trabajo verificado no se presenta como QA Forge.

Sprint 1 debe cubrir el paso 1 y la base del paso 2: contrato exacto, seguridad/aislamiento y create/status/context pack mínimos. Las funciones de ejecución y promoción pertenecen a sprints posteriores para que no se introduzca un segundo lifecycle antes de probar su base.

## Acceptance and validation matrix

| Resultado/invariante | Escenario y evidencia requerida | Método |
| --- | --- | --- |
| Selección explícita | `idea`/`forge` no crean Work; `/kyro:work` sí | Fixtures de routers y CLI |
| Cualquier plan puede usar Work | Plan con muchas tareas, ciclos largos y dependencias válidas no se rechaza por tamaño conceptual | Fixture de stress acotado a límites técnicos |
| JSON sólo CLI | `create/plan/evidence/review` producen forma exacta; clave extra falla | Schema tests y CLI E2E |
| Estado aislado | Hashes de `project.json`, `local.json` y `sprint.json` idénticos antes/después | Regresión de snapshot |
| Rutas seguras | `..`, absoluto, symlink, archivo no-directorio y carrera fallan | Pruebas de filesystem |
| Atomicidad | Fallo de validación/escritura deja archivo anterior íntegro | Inyección de fallos |
| Revisión vigente | Cambio de criterio, brief o evidencia invalida `pass` | Prueba de transición/digest |
| Dependencias verdaderas | Bloqueo/cancelación no habilita dependiente; ciclo rechazado | Grafo de tareas |
| Reanudación | Nueva sesión recibe `nextAction` y `nextTaskId` correctos | `context-pack --json` con fixtures |
| Cierre honesto | `completed` exige terminalidad; `stopped` enumera pendientes | CLI preview/confirm y status |
| Trackability | `work.json`/`brief.md` no quedan ignorados | `git check-ignore`, instalación/sync |
| Promoción trazable | Enlace recíproco, idempotencia y fallo parcial sin éxito falso | Contrato + inyección de fallos en etapa 6 |
| Forge sin regresión | Rutas y pruebas existentes siguen iguales | Suite actual y comparación de artefactos |

## Forge handoff

**Scope propuesto:** `organic-work`.

**Objetivo:** entregar en Kyro AI el camino Work de elección explícita, con estado Work CLI-owned y versionado, ejecución verificable por tareas y garantías de aislamiento para Forge. La promoción Work → Forge es un resultado posterior condicionado a contrato transaccional probado.

**Requirement candidates:** R1 elección explícita; R2 esquema exacto; R3 escritura CLI y atomicidad; R4 brief/digest; R5 planificación y dependencias; R6 evidencia/review; R7 enmienda/invalidez; R8 cierre honesto; R9 context pack; R10 instalación/trackability; R11 aislamiento/regresiones Forge; R12 promoción explícita e idempotente. Cada R debe enlazar escenarios de la matriz anterior.

**Non-goals:** auto-selección por tamaño, edición manual de `work.json`, cambio de contratos Forge, migración Forge → Work, QA integral implícita, delegación por defecto.

**Orden:** Sprint 1 contrato + base segura y lectura; Sprint 2 tareas/evidencia/revisión; Sprint 3 enmiendas/cierre/entrada pública; Sprint 4 promoción y certificación integral, ajustable por pruebas. No crear sprints futuros hasta cerrar/decidir el anterior. La implementación puede redistribuir tareas cuando la evidencia lo requiera sin perder los requisitos.

**Sprint 1 sugerido:** T1.1 formalizar esquema, tipos y transiciones Work v1 con fixtures; T1.2 persistencia confinada, atómica y controlada por revisión; T1.3 create/status/context pack y brief digest con pruebas de aislamiento; T1.4 trackability e instalación mínima sólo si las dependencias T1.1-T1.3 están verdes. No ejecutar tareas ni cerrar sprint sin la aprobación correspondiente.

**Gate de éxito del scope:** tests de Work y Forge, seguridad de rutas, fallos transaccionales, package/install/update, dos clones, recuperación y promoción; revisión de contrato observable. `npm run check` por sí solo no equivale a certificación semántica o seguridad de todas las rutas.

## Quality gate

Evaluación del artefacto: tesis/causalidad 15/15; evidencia 14/15; claridad 15/15; resultados observables 15/15; invariantes/fallos 10/10; decisiones/tradeoffs 10/10; coherencia de alcance 10/10; handoff ejecutable 10/10. **99/100**. La única reducción reconoce que los números de línea y el estado de herramientas pueden cambiar antes de implementar. Se revisaron la conversación, router Idea/Forge, plantilla Seedbed, CLI dispatch, lock de rutas, tipos/schema/context-pack, documentación maker-checker y `.gitignore`. No queda contradicción material sin resolver; detalles menores de flags se pueden fijar durante la implementación conservando las garantías normativas de este plan.
