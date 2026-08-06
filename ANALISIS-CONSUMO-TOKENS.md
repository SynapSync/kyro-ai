# Análisis: consumo de tokens en Kyro y sobre-fragmentación de sprints

> **Estado:** VALIDADO con datos reales del caso de la queja (`club-inventory-output`). Diagnóstico corregido — ver sección "Validación con datos reales".
> **Fecha:** 2026-07-17
> **Origen:** reporte de un usuario real de Kyro — "esto es bueno para los millonarios. Kyra generó 4 sprints para un caso más sencillo que los anteriores; el primer sprint solo se comió +20% de mis tokens y faltan 3."
> **Archivo interno** — NO se publica en npm (no está en `package.json.files[]`).

---

## TL;DR

El motor de Kyro (1 agente + skills + configs `.json`) es genuinamente liviano y lazy-loaded: en cualquier turno hay ~200–400 líneas de "motor" en contexto. **El motor NO es lo que consume tokens.** El costo en un flujo agéntico viene de (a) la acumulación de contexto turno a turno y (b) la profundidad del trabajo que Kyro elige hacer.

**Tras validar con datos reales + reconciliar con la auditoría forense de Codex** (ver sección "Reconciliación"), la causa dominante NO fue el motor ni el sizing sino, en orden de peso medido:

1. **(Codex H-001 — DOMINANTE, ~60–80% en sesiones con exploración)** Outputs de herramientas sin acotar: un `rg` amplio = 77.284 tokens; suite de tests = 10.638 tokens por corrida, re-ejecutada en cada punto de validación. *Caveat:* parte del `rg` de 77K fue la propia investigación de Codex; el driver recurrente real es el output de tests.
2. **(Falla #4 / Codex H-002 — real, magnitud CORREGIDA)** Leer `sprint.json` completo (~7K tokens) / checkpoints (~18K) / specs en vez del `context-pack` (~1.8K). Ahorro real ~5–10K por reanudación, NO los ~150K que estimé antes (era peor-caso especulativo). **El fix ya existe shippeado: `kyro context-pack`.**
3. **(Falla #3)** Nada fuerza contexto fresco entre sprints → correr los sprints en una sola sesión compone todo lo anterior (todo se re-factura cada turno). Kyro documenta "un sprint por sesión" pero no lo obliga.
4. **(Falla #2 — magnitud CORREGIDA)** El modo review en sí es barato (~996 tokens). Lo caro es la suite de tests que cada review dispara (ver #1), no la ceremonia.
5. **(Falla #1 — descartada)** El sizing fue legítimo en los dos scopes reales. Riesgo teórico, no observado.

Ninguna es "el motor" (runtime routed ~2.5–4K, eficiente). Todas son corregibles, y varias mitigaciones YA existen en Kyro (`context-pack`, budget classes, autocompact) — el problema es que no son default ni enforced.

---

## Por qué el motor NO es el problema (lo que el usuario acertó parcialmente)

Verificado en el repo:

- Todo el motor son ~2.150 líneas de skills + 76 del orchestrator + 216 de comandos, **en total**.
- **Nunca se cargan todas a la vez.** El orchestrator carga `SKILL.md` (105 líneas) + **un solo modo** (26–92 líneas) + a lo sumo un helper. Las plantillas se cargan solo justo antes de escribir su artefacto.
- El estado vive en `sprint.json` como fuente única ("dos lecturas para arrancar, un archivo por acción").
- Los sprints cerrados se snapshotean a `archive/` (write-only) y se limpian de `activeSprint`, así que `sprint.json` **no** crece sin límite: solo arrastra `ledger[]` (resúmenes), `conventions[]` y `debt[]`. El crecimiento está acotado. (Punto a favor del diseño — ser justos con esto.)

**Conclusión:** decir "Kyro no gasta tokens porque los `.json` no pesan" es cierto en la premisa pero falso en la conclusión. El costo nunca vino del peso de los configs.

---

## Segundo proyecto analizado — `fsd-architecture-migration` (7 sprints, 16 sesiones)

Proyecto en `bb_center_club_app/.agents/kyro`. **Patrón de uso BUENO** (16 sesiones en 3 días, no una maratón) y **aun así caro** → aísla las causas estructurales de Kyro de las de comportamiento.

### Hallazgo #1 (MÁXIMA PRIORIDAD) — `context-pack` existe pero NUNCA se usó

171 eventos de trace, **56 llamadas a `review`**, **0 usos de `context-pack`**. Cada routing/execute/review cargó el `sprint.json` completo (~17.6K tokens) en contexto. Desperdicio ~15.8K por lectura vs el pack lean (~1.8K). Con decenas de lecturas → cientos de miles de tokens tirados. **Causa: `context-pack` es opt-in y nada en el flujo lo sugiere; el agente (Codex) nunca lo alcanzó.**

### Hallazgo #2 — el `sprint.json` vivo es gordo y mezcla estático con dinámico

86 KB en disco / ~17.6K tokens serializados. Composición: `activeSprint` 53% (Sprint 6 = 13 tareas, cargas las 13 aunque trabajes 1), `spec` 24% (15 requirements + 28 scenarios, **estático** pero re-leído siempre), `conventions` 7%, `ledger` 6%, resto ~10%. **~40% de cada lectura es referencia casi inmutable.** El "single fat SoT" optimiza escritura y castiga lectura.

### Hallazgo #3 — fricción sistémica del checker (en AMBOS proyectos)

Del `blocked_reason`:
- **Verdict malformado (A002/A003):** T1.3, T1.6, T3.1, T3.2 (fsd) + T1.1, T4.1 (inventory). El maker escribe verdict/evidencia en formato que el checker rechaza → rework. Sistémico, no error de usuario.
- **`[NEEDS CLARIFICATION]` bloqueando cierre (A001):** Sprints 1 y 3 llegaron al gate con marcadores sin resolver → bloqueo → ida y vuelta. Falla de calidad de planificación.
- **`CONFIRMATION_REQUIRED` en review_task (6×, a veces doble):** gate que interrumpe y se re-dispara.

### Decisiones de diseño a optimizar (ranked por leverage)

| # | Optimización | Leverage | Evidencia | Esfuerzo |
|---|--------------|----------|-----------|----------|
| O1 | ✅ **IMPLEMENTADO + VERIFICADO (2026-07-17).** `context-pack` es ahora el camino de lectura/routing por defecto. **Verificación end-to-end sobre datos reales** (scope de prueba con `activeSprint` archivado real, 85 KB/~21.4K tok): scope pack 2 253 tok (−77% vs 9 884), task pack 2 269 tok (−89% vs 21 441) con description/files/context/acceptance/scenarios completos, review pack con nextTaskReview+checkerFindings. El agente NO se ve forzado a abrir el archivo. `doctor --tokens` 7/7 PASS; `npm run check` verde. | ALTÍSIMO (~15–19K/lectura) | 0 usos en 56 reviews | Bajo-Medio |
| O2 | **Partir el estado**: separar lo estático (`spec`, `scenarios`, `roadmap`) de lo vivo (`activeSprint`, `handoff`), para que las lecturas de routing no re-carguen el ~40% inmutable. | Alto | spec=24%, conventions/ledger/roadmap ~16% | Medio-Alto |
| O3 | **Relajar el Artifact Write Contract para evidencia append-only**: no re-leer 86 KB para registrar el evidence de una tarea. | Alto | ~13 writes/sprint × 17.6K | Medio |
| O4 | **Robustecer el formato de verdict** o hacer que el maker lo genere vía CLI (no a mano) para eliminar el rework A002/A003. | Medio | malformed verdict en ambos proyectos | Medio |
| O5 | **Resolver `[NEEDS CLARIFICATION]` en planificación**, no arrastrarlo al gate de cierre. | Medio | A001 en Sprints 1,3 | Bajo |
| O6 | **Revisar el gate CONFIRMATION_REQUIRED de review_task** que se re-dispara. | Bajo-Medio | 6× doble-firing | Bajo |
| O7 | ✅ **IMPLEMENTADO (2026-07-17).** El paso 3 de Startup de `forge`/`status` (y orchestrator) ahora arranca con `context-pack` — el pack lean es lo primero que se lee al reanudar. | Alto (refuerza O1) | Codex H-007 | Bajo |

## Evidencia del trace de la corrida completa (2026-07-17)

Se analizó el `trace/events.ndjson` del CLI de Kyro de la corrida completa de los 4 sprints (`club-inventory-output`, folder actualizado). Es el log de eventos del CLI — **no captura los `rg`/`Read`/tests del agente** (dominio de Codex), pero revela la estructura de la ejecución.

**Confirmación DEFINITIVA de Falla #3 (sesión única):** los 4 sprints corrieron entre **15:51 → 20:31 = ~4h40m en UNA sola sesión**. Para el Sprint 4, el contexto arrastraba los Sprints 1–3 completos, re-facturándose cada turno. Kyro documenta "un sprint por sesión" (`context-management.md:93`); se corrieron cuatro. Este es el amplificador maestro del "50% y sin terminar".

**HALLAZGO NUEVO — loops de rechazo del checker (rework), concentrados en Sprint 1:** el checker rechazó pases y forzó reintentos (cada uno = re-leer estado + corregir verdict/evidencia + re-correr `kyro review`):

| Task | Evento |
|------|--------|
| T1.1 | falló 2× (A001 verdict malformado → CHECKER_FAILED) antes de pasar |
| T1.4 | CHECKER_FAILED → reintento |
| T1.5 | CHECKER_FAILED → reintento |
| S4.P1.T4.1 | A001 verdict malformado → reintento |
| S4.P2.T4.4 | CHECKER_FAILED → reintento |
| S4.P3.T4.5 | revisado 2× (redundante) |

**El Sprint 1 tuvo 3 de 6 tareas con rechazo del checker (16:14–16:51)** — justo el sprint que "se comió el 20%". Parte importante de ese costo fue rework por el checker, no solo lecturas de archivo.

**Ceremonia de CLI (34 `tool_command_run`):** 25× `review` (una por tarea), 4× `close-sprint`, 5× `repair` (re-serializa `sprint.json` completo tras cada close). Más 54 `validation_result` (11 de `doctor`, 43 de `analyze`) — `analyze` corre antes de cada cierre emitiendo 10–16 findings que el agente lee.

**Nota sobre budget routing:** `route_selected` muestra que el ruteo de budget SÍ se activó (execute_task→`execute`, close_sprint→`close`, plan_sprint→`brief`, con packMode task/scope). O sea el mecanismo lean estaba operando a nivel de routing; el gasto vino de rework + tool outputs + sesión larga, no de un ruteo defectuoso.

**Límite honesto:** los huecos de tiempo (p. ej. T3.4→T3.5 = 31 min; la hora 19:00 solo con `repair`) son donde el agente ejecutaba código y corría tests que NO aparecen en el trace. El trace subestima el costo real; los outputs grandes ocurrieron en esos huecos.

## Reconciliación con la auditoría forense de Codex (2026-07-17)

Un segundo agente (Codex) hizo una auditoría forense midiendo bytes/tokens reales del flujo (Sprint 4 de `club-inventory-output`). Documento: `~/Downloads/forensic_token_consumption_codex_kyro_2026-07-17.md`. Reconciliación honesta:

**Codex me corrige en dos magnitudes (me retracto):**
- **Falla #4:** yo estimé ~150K tokens/sprint por releer `sprint.json`. Era peor-caso especulativo, NO medido. Codex midió: `sprint.json` ~7K tokens; ahorro real vía `context-pack` ~5–10K por reanudación. Real, pero mucho menor.
- **Falla #2:** el modo review pesa solo ~996 tokens. El costo no es la ceremonia sino la suite de tests que dispara (~10K/corrida).

**Codex aporta la causa dominante que yo subestimé:**
- **H-001: output de herramientas sin acotar** (`rg` 77K, tests 10.6K) domina el consumo observado (~60–80%). Es disciplina de comandos/agente, NO el motor Kyro. Caveat: el `rg` de 77K fue en parte la propia auditoría de Codex.

**Hallazgo clave verificado en NUESTRO repo (kyro-ai):** las mitigaciones YA existen shippeadas:
- `kyro context-pack` (`src/cli/commands/context-pack.ts`) → pack lean ~1.8K vs abrir `sprint.json` completo.
- `budget-manifest` + budget classes en `config.json` (`brief` 1.5K / `execute` 2.5K / `review` 2.5K / `close` 3.2K) — `docs/cost-model.md`.
- `kyro token-audit` / `doctor --tokens` para auditar rutas.
- Guía "un sprint por sesión" + `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50` + pre-compaction checkpoint — `docs/context-management.md`.

**Implicación:** el trabajo NO es "construir" fixes nuevos, sino **wire-in / enforce / adopción** de lo que ya existe. Codex H-007: el control existe pero depende de disciplina de uso; el agente puede saltarse el camino lean y abrir artifacts completos.

**Convergencias entre ambos análisis:** el motor routed de Kyro es eficiente (no es la causa); el sizing no fue factor; no hubo subagentes.

## Validación con datos reales (2026-07-17) — CORRIGE el diagnóstico

Se revisaron DOS proyectos Kyro reales:

- **`fsd-architecture-migration`** (proyecto `bb_center_club_app`): 7 sprints, migración FSD dominio-por-dominio. Sizing legítimo (strangler, cada dominio es bounded context con god pages). El heurístico funcionó bien.
- **`club-inventory-output`** (proyecto de la queja, en `~/Downloads/agents`): **este es el caso del usuario.** 4 sprints; al quejarse cerraba el sprint 1 con 3 pendientes.

### Datos duros de `club-inventory-output`

| Sprint | Fases | Tareas | Evidencias | Verdicts (reviews por-tarea) |
|--------|-------|--------|-----------|------------------------------|
| 1 | 3 | 6 | 6 | 6 |
| 2 | 4 | 7 | 7 | 7 |
| 3 | 4 | 6 | 6 | 6 |

`sizingRationale`: *"touches shared core choices and SQL, public APIs, catalog resolution, financial rules, inventory locking, credit ledgers, idempotency, and historical queries. Fewer sprints would bundle persistence and concurrency risk before contracts are verified."*

**Verdicto sobre el sizing: LEGÍTIMO, no inflado.** Trabajo transaccional real (locking, ledgers de crédito, idempotencia, concurrencia). La sensación de "más sencillo que los anteriores" es *relativa* al scope de 7 sprints, no absoluta.

### CORRECCIÓN al diagnóstico

- **Falla #1 (sizing sesgado): NO se manifestó en ningún caso real.** Ambos scopes están bien dimensionados. Se degrada a "riesgo teórico, no observado" — vale mantener el fix como mejora preventiva, pero NO fue la causa de la queja.
- **La causa real del gasto es la Falla #4 (abajo) + Falla #2, no el número de sprints.**

## Falla #4 (LA CAUSA REAL) — El `sprint.json` "gordo" se re-lee completo en cada micro-transición

**Dónde:** el "Artifact Write Contract" en `SKILL.md` + el paso `Inputs` de cada modo.

- `sprint.json` de `club-inventory-output` pesa **~27 KB** (~7K tokens) y **crece** a medida que se acumulan `evidence`/`verdict`.
- El contrato de escritura **prohíbe ediciones parciales**: cada mutación es `leer archivo completo → parse → mutar → sobrescribir → re-parsear`. Cada write = **dos** lecturas completas.
- Cada tarea recorre `execute_task` (lee + escribe = re-lee) → `review_task` (lee + CLI review escribe = re-lee). ≈ **4 lecturas completas del archivo por tarea**.
- Sprint 1 = 6 tareas ≈ **~24 lecturas de un archivo de 20–27 KB** ≈ **~150K tokens solo barajeando el estado**, antes de tocar código.
- Esas ~24 copias **quedan en el contexto** y se re-facturan en cada turno posterior. Con los 4 sprints en una sola sesión (Falla #3), compone.

**Este es el costo dominante y es específico de Kyro:** un archivo de estado único y "gordo", re-leído completo ~24 veces por sprint, multiplicado por el review por-tarea.

**Fix propuesto (alto impacto):**
- Evitar re-leer `sprint.json` completo cuando ya está en contexto y no cambió por un tercero (confiar en el estado en memoria del turno; re-leer solo tras operaciones tool-owned del CLI).
- Considerar lecturas/escrituras parciales seguras (p. ej. por-tarea) en vez del contrato "archivo completo siempre", o partir el estado (activeSprint en un archivo aparte del roadmap/ledger/spec estáticos).
- Combinar con el fix de Falla #2 (review agrupado) para cortar el número de transiciones que disparan re-lecturas.

## Falla #1 — El sizing está sesgado a fragmentar (RIESGO TEÓRICO — no observado en datos reales)

**Dónde:** `internal/skills/sprint-forge/assets/helpers/analysis/feature.md:26` y `internal/skills/sprint-forge/assets/modes/INIT.md:39` (Step 4 — Size the roadmap).

Los "sizing signals" reales:

> *"Multiple sprints are justified when the feature has a dependency chain, public interface change, reusable foundation, separate review units, or risk that should be proven independently."*
> *"One sprint is acceptable when the change is cohesive, low risk, and can be reviewed end-to-end safely."*

**Problemas:**

- Los disparadores de "múltiples sprints" son tan amplios que **casi cualquier feature los cumple** (¿qué feature no tiene cadena de dependencias, cambio de interfaz o unidades de review separables?). Un modelo diligente siempre encuentra razón para partir.
- La opción de 1 sprint está redactada como **excepción** ("acceptable"), no como default.
- `INIT.md:39` — *"Never pad to look thorough"* — es una amonestación blanda: **sin tope duro, sin presupuesto, sin ejemplos calibrados** que anclen "esto simple = 1 sprint".
- La palabra "sprint" arrastra sesgo Agile: el modelo asocia "sprint" con "trocear en varios".

**Efecto neto:** el heurístico empuja *direccionalmente* hacia más sprints.

**Fix propuesto:**
- Invertir el default: arrancar en **1 sprint** y exigir justificación *positiva* por cada sprint adicional.
- Que `sizingRationale` argumente por qué **NO menos** sprints (no solo por qué esta cantidad).
- Añadir 2–3 ejemplos calibrados ("feature cohesivo, <~N archivos, sin riesgo independiente = 1 sprint").

---

## Falla #2 — El review por-tarea multiplica el costo dentro de cada sprint

**Dónde:** `internal/skills/sprint-forge/assets/modes/execute-task.md` + `review-task.md`.

El loop real es `execute_task → review_task → CLI review → siguiente tarea`, **por cada tarea**. Cada `review_task`:
- re-lee `sprint.json`,
- carga `reviewer.md`,
- corre checks,
- ejecuta un comando CLI (`{{KYRO_CLI}} review ...`).

Para un caso simple con muchas tareas chicas repartidas en 4 sprints, son **decenas de round-trips de review con ceremonia completa sobre tareas triviales**. Cada round-trip = más turnos = más acumulación de contexto = más tokens.

**Fix propuesto:** permitir agrupar el review a nivel de **fase o sprint** para trabajo de bajo riesgo; reservar el review por-tarea para tareas marcadas como riesgosas.

---

## Falla #3 — Nada fuerza contexto fresco entre sprints (el pico de costo)

**Dónde:** `internal/skills/sprint-forge/assets/modes/close-sprint.md` + comando `task-context`.

`close-sprint` publica un checkpoint lossless **justo para permitir retomar en sesión fresca y barata** — el diseño lo soporta. Pero **nada en el flujo empuja al usuario a resetear el contexto** al cerrar un sprint. El usuario, naturalmente, sigue en la misma sesión → el sprint 4 arrastra el contexto de los 3 anteriores → peor caso de tokens, como default de facto.

**Fix propuesto:** que el output de `close-sprint` recomiende explícitamente arrancar el siguiente sprint en **sesión fresca** y muestre/genere el prompt de `/kyro:task-context` automáticamente.

---

## Qué está confirmado vs. qué falta validar

- **Confirmado (en código):** las tres fallas de diseño existen tal como se describen.
- **Falta validar (necesita datos reales):** cuál de las tres pesó más en el caso concreto del usuario. Es decir: ¿sobre-sizing real, o el caso era genuinamente más grande de lo que sentía? ¿Las tareas eran triviales (falla #2) o legítimas?

### Cómo validar
- **Opción A (mejor):** obtener el `sprint.json` del scope en cuestión — `.agents/kyro/scopes/{scope}/sprint.json` en la máquina del usuario. Revela `sizingRationale`, número de tareas por sprint, y si eran triviales.
- **Opción B:** resumen de qué era el caso + títulos/objetivos de los 4 sprints. Permite juzgar si el split fue artificial o legítimo.

Con eso se emite el veredicto concreto ("el sprint 2 y 3 debieron ser uno" vs. "el caso sí ameritaba 4, pero el review por-tarea se comió el 20%") y sale el fix de producto real.

---

## Respuestas de comunicación (para el usuario que reportó)

**Mensaje sugerido (customer-facing):** validar el síntoma, explicar que la causa no es el motor sino (1) contexto acumulado en una sola sesión y (2) profundidad de planificación; recomendar menos sprints más grandes + `/kyro:task-context` para arrancar cada sprint en fresco; ofrecer revisar el scope concreto.

**Argumento fuerte:** sin la disciplina de Kyro (lean loading, un sprint activo, fuente única) la misma cantidad de trabajo costaría *más*, no menos. Kyro no infla el consumo — pero correr los 4 sprints en una sesión paga el peor caso, y eso es evitable.
