---
docType: plan
date: 2026-09-17
slug: change-current-work
title: Cambiar el trabajo vigente sin congelarlo
maturedFrom: mature
agents: []
---

# Cambiar el trabajo vigente sin congelarlo

## Core thesis

Kyro ya sabe crear y ejecutar un plan; el fallo de producto es que **proteger el historial congela también el trabajo vigente**. Un agente o un usuario debe poder corregir un requisito y sus tareas, reemplazar una regla local, reorganizar sprints futuros o descartar un scope vivo **con verbos tool-owned existentes o mínimamente extendidos**, sin borrar evidencia, sin parar trabajo independiente y sin un journal de revisiones. La promesa: cambiar lo actual es más barato que el workaround (otro sprint, deuda falsa, editar JSON).

## Problem / Motivation

La causa no es “falta un CMS de estado”. Es un desajuste de frontera: archives, evidencias y close checkpoints deben ser inmutables; el contrato **vivo** (spec actual, tasks del sprint abierto, reglas locales, roadmap `planned`, scope aún no retirado) no debería estarlo.

Consecuencia observable: frases cotidianas se vuelven callejones — crear otro sprint, registrar deuda como escape, encadenar dispose→close→retire, o editar `sprint.json` a mano. Los agentes disciplinados empeoran el cuadro porque obedecen `handoff.nextAction`, y ese campo a veces **miente** (`execute_task` sin task ready).

Importa ahora porque Plan 14 ya abrió la puerta correcta (`plan --update-active`) y Plan 15, en otra rama, sobre-ingenió el mismo problema. Este plan recorta a cuatro casos y se ejecuta desde `origin/develop` (`36c3897`), no desde el journal.

## Current-state evidence

Hechos observados en `plan/agent-unblock` = `origin/develop` `36c3897`, Kyro 4.50.0. Plan 15 **no** está en este árbol (`src/cli/core/revision.ts` ausente).

- **E1 — Caso 1 parcialmente resuelto.** `src/cli/core/active-plan.ts` acepta en un solo digest `tasks` + `requirements` + `scenarios`; invalida verdicts afectados, pasa `done`→`pending` en consumidores, **conserva evidencia**. No hay operación de **remove** de requisito; un scenario no puede cambiar su `requirement` identity. Fuente: lectura de `parseActivePlanInput` / `prepareActivePlan`.
- **E2 — Cancelar tarea es otro comando.** `src/cli/commands/record-evidence.ts` — `--disposition cancelled|deferred|superseded`. No forma parte de `--update-active`.
- **E3 — Handoff mentiroso.** `src/cli/commands/record-evidence.ts:259`: si hay disposition o blocked temporal y no hay ready ni review, igual emite `execute_task`. `active-plan.ts` solo pisa `nextAction` cuando existe `nextExecutableTaskId`; si es null, deja el handoff anterior.
- **E4 — Caso 2 inexistente.** `src/cli/commands/rule.ts` solo `add`. `adr.ts` solo `add`. No hay `update|remove|replace`.
- **E5 — Caso 3 inexistente.** `src/cli/commands/plan.ts` escribe `roadmap` en init y marca `state: active` al materializar. No hay writer posterior para retitular, añadir, cancelar o reordenar entradas `planned`.
- **E6 — Caso 4 es una cadena, no un verbo.** `src/cli/checkpoints/scope-retirement.ts:416–417` rehúsa retire si `activeSprint` está set: *“Complete or otherwise resolve the active sprint first; retirement never closes or discards it.”* `close-sprint` ya admite `--outcome abandoned` en sprint parcial.
- **E7 — Deuda no se cancela.** `src/cli/commands/debt.ts`: `add|start|resolve|defer|escalate`. No `cancel`. Fuera de v1 salvo que un fixture de S0 demuestre un callejón sin E2/E4.
- **E8 — Independencia parcial.** El tip `36c3897` es `fix(scheduler): keep independent tasks moving`. `record-evidence.ts` documenta que un blocked temporal no debe parar ready work — contradicho por E3 cuando no hay ready.
- **E9 — Integridad ya existe.** `doctor`, `repair`, `repair integrity` están en `TOOL_OWNED_VERBS`. Envelope ya parsea `remedyCommand` desde prosa de error (`src/cli/core/cli-envelope.ts`). Status/context-pack no exponen un `blocker` estructurado.
- **E10 — Plan 14 es el patrón.** `docs/plans/plan-14-active-work-task-editing.md`: preview → digest → apply bajo lock; no hand-edit; evidencia previa no es aprobación vigente. Este plan **extiende** ese patrón; no lo reemplaza.
- **E11 — Plan 15 es otra rama.** `work/plan15-b1b1-certification` / `develop` local contienen `--revise`, schema 5 y transacciones de convenciones. Decisión de producto: no se mergean aquí.

Hipótesis (no hechos): H1 los cuatro casos cubren el 90% de atascos reales; H2 `--global`/mirrors reabrirían Plan 15; H3 agentes usarán `remedyCommand` si viaja en JSON (hace falta S6 para probarlo).

## Who it's for

- **Primario:** agentes de forge/executor que siguen `nextAction` y se paran cuando el contrato vivo está mal y no hay verbo. Decisión que este artefacto habilita: aplicar un remedy tool-owned bajo la autoridad de trabajo ya dada, luego doctor.
- **Primario:** el operador (usuario) que dice una de las cuatro frases y espera que Kyro cambie el plan, no que le pida otro scope.
- **Secundario:** reviewers/QA de Kyro que deben poder certificar “live ≠ archive” sin un journal. Decisión: aprobar un scope acotado a cuatro casos, no W0–W7.

## What success looks like

Falsificable en CLI + doctor, no en prosa:

1. Un `--update-active` cambia un requisito y las tasks actuales que lo consumen; evidencia previa sigue en el task; un `pass` no afectado permanece `pass` y runnable.
2. `rule replace` local deja de presentar la regla vieja en packs efectivos; el texto viejo no desaparece del historial de convenciones del scope.
3. Roadmap `planned` se puede retitular, añadir, cancelar y reordenar; `n` de sprints closed/active no cambia.
4. `scope discard --digest --yes` sobre un scope con sprint activo termina en scope retired + close `abandoned`, sin editar JSON a mano.
5. Tras dispose del último unfinished, `nextAction` no es `execute_task` sin `nextTaskId` ready.
6. Tras cada write de 1–4, `kyro doctor --json` sale limpio (y `--artifacts` si mutó sprint/project).
7. Schema de sprint sigue 4. No aparecen records `kyro.live-revision` ni `project-convention-transaction`.

Falso éxito: el CLI acepta el comando pero el handoff sigue mintiendo; la regla vieja sigue en context-pack; discard deja `activeSprint` set; doctor rojo se ignora; se introduce schema 5.

## Product laws / invariants

1. **Live ≠ archive.** Scope abierto + sprint unclosed = editable. Checkpoints de close, completion, retirement, evidencias y verdicts de pass = inmutables. Evita reescribir historia.
2. **Evidencia no es candado.** Conservar blobs/notas; invalidar solo aprobación vigente de consumidores afectados. Evita “para cambiar el requisito borro el trabajo hecho”.
3. **Trabajo independiente sigue.** Nunca `execute_task` sin task dependency-ready. Evita que una corrección local pare el sprint.
4. **Tool-owned.** Cero hand-edit de managed JSON. Evita corrupción y bypass de lock.
5. **Un digest agrupa lo dependiente del caso.** Requisito+tasks juntos; replace de regla es un apply; discard es un consentimiento. Evita estados intermedios inválidos que el agente no puede terminar.
6. **Doctor es la red.** No hay segundo journal ni obligaciones que bloqueen un close exitoso. Evita el fail-closed extra de Plan 15.
7. **Schema 4.** Evita romper readers viejos y Lens. Compatibilidad > fence de writers.
8. **`--yes` no es identidad.** Confirmación mecánica. Discard y retire siguen siendo consentimiento humano informado.

## Observable success and failure guarantees

| Estado | Comportamiento |
| --- | --- |
| Éxito | Preview con digest; apply idéntico; doctor limpio; handoff reconstruido desde ejecución real. |
| Vacío | `--update-active` sin tasks/requirements/scenarios sigue siendo inválido; roadmap sin entradas `planned` rehúsa cancel/reorder. |
| Parcial | Discard interrumpido: retry el mismo digest; cada etapa usa el writer idempotente ya existente (disposition, close, retire). No hay WAL nuevo. |
| Input inválido | Requisito remove con scenario/task vivo y sin relink/cancel en el mismo request → rechazo, cero writes. Rule replace de id inexistente → rechazo. Roadmap que toca `n` closed/active → rechazo. |
| No autorizado | Discard/retire sin digest+yes → `CONFIRMATION_REQUIRED`. Correcciones 1–3 bajo autoridad de trabajo ya dada: preview+apply en el mismo turno. |
| Irrecuperable | Doctor/artifacts rojo tras apply → el helper para y reporta; no continúa el `execute_task` muerto. Repair/integrity existentes cubren estado derivado, no este plan. |

## Outcome-based scope

### In

- Caso 1: extender `plan --update-active` con remove de requisito (atómico con relink/cancel de consumidores) y cancel de task in-band (disposition `cancelled` + reason).
- Caso 2: `rule update|remove|replace` **scope-local**.
- Caso 3: `plan --roadmap` para entradas `state: planned` (title, add, cancel, reorder de presentación; no renumerar closed/active).
- Caso 4: `scope discard` = un preview/apply que orquesta disposition cancel → `close-sprint --outcome abandoned` → `scope retire` con un consentimiento.
- Handoff honesto + `blocker`/`remedyCommand` en status, context-pack y envelope.
- Helper de skill: si hay `remedyCommand` y el cambio es trabajo vigente ya autorizado, aplicar y correr doctor.
- `kyro doctor --json` (y `--artifacts` si mutó sprint/project) después de cada write de estos verbos.

### Explicitly out

- `--global` / convenciones de proyecto / mirrors / principios — es el detonante de Plan 15.
- `plan --revise`, schema 5, revision records, fences de `revision-pending`, obligaciones que bloquean close.
- ADR update/supersede, questions resolve/withdraw, `debt cancel` (salvo que S0 demuestre callejón sin verbos de v1).
- Lens, MCP, W7, composite discard como protocolo de storage nuevo.
- Hand-edit de `sprint.json`.

## Closed decisions with rationale

1. **Base = `origin/develop` `36c3897`, no `develop` local.** Evidencia E11. Tradeoff: se pierde `--revise` ya escrito. Consecuencia: v1 no carga schema 5 ni el core B1b.
2. **Patrón Plan 14, no journal Plan 15.** E10 vs E11. Tradeoff: menos auditoría de “quién cambió el spec”. Consecuencia: doctor + records de close/disposition bastan.
3. **Caso 3 = `plan --roadmap`, no mezclado en `--update-active`.** Evita que un update de tasks arrastre el roadmap. Tradeoff: un verbo más. Consecuencia: caso 1 permanece acotado al sprint actual.
4. **Caso 4 = `scope discard` que orquesta writers existentes, no WAL.** E6: close abandoned y retire ya existen. Tradeoff: no hay atomicidad cross-file más allá de lo que ya da cada writer + retry de digest. Consecuencia: un consentimiento humano, etapas reanudables.
5. **Caso 2 solo local en v1.** H2. Tradeoff: cambiar una convención de equipo sigue siendo `rule add --global` + convivir con copias. Consecuencia: el callejón “esta regla ya no aplica” se resuelve para reglas de scope.
6. **No hay `NextAction` nuevo.** E3 se corrige no emitiendo `execute_task` falso; el skill usa `remedyCommand`. Tradeoff: routing table intacta. Consecuencia: menos superficie de adapters.
7. **S0 rojo antes de writers.** Los cuatro casos + fake execute_task deben fallar hoy. Tradeoff: un slice sin feature. Consecuencia: no se inventan verbos que S0 no justifique.

## Constraints and tradeoffs

- Compatibilidad: schema 4, capabilities aditivas, Plan 14 intacto.
- Seguridad: lock de writer existente; probes mutantes solo con `scripts/lib/guarded-cli-probe.mjs`.
- Autoridad: casos 1–3 = autoridad de trabajo ya dada; caso 4 = aprobación humana explícita (igual que retire).
- Tiempo: v1 son cuatro casos, no la matriz de 12 dominios de Plan 15.
- Runtime instalado en esta máquina puede ser un 4.50.0 con `--revise` local; este branch **no** lo incluye. Validar contra el CLI de **este** checkout, no contra `~/.agents/kyro/current` si diverge.

## Risks, failure modes and degradation

| Riesgo | Trigger | Impacto | Contención | Señal |
| --- | --- | --- | --- | --- |
| Discard a medias | Crash entre close y retire | Scope closed-abandoned pero no retired | Retry mismo digest; retire ya es resumable | `scope inspect` + doctor |
| Fake execute_task se queda | Solo se arregla record-evidence y no update-active | Agentes siguen congelados | S1 cubre ambos writers de handoff | Fixture S0 |
| Rule replace no actualiza packs | Se borra en sprint.json pero context-pack cachea | Agente sigue viendo la regla | Tests de full/concise/task pack en S3 | Pack sin el id viejo |
| Roadmap reorder se interpreta como `n` | Implementación floja | Identidades closed se mueven | Rechazo si `n` closed/active cambia | Fixture S4 |
| Agentes no cargan el helper | S6 omitido | Verbos existen y nadie los usa | Helper en forge/executor + capabilities | Clean-HOME projection |
| Tentación `--global` | “una regla de proyecto” | Reabre Plan 15 | Help y capabilities: `applySupported` local only | Review de S3 |

## Material open questions and decision impact

Ninguna material. Las tres decisiones de producto (roadmap aparte, discard orquestado, reglas locales) las cerró el usuario el 2026-09-17.

No bloqueante: si S0 muestra un callejón de deuda obsoleta sin `resolve` mentiroso, `debt cancel` puede entrar como follow-up, no como v1.

## Execution blueprint

### S0 — Fixtures rojos

- Objetivo: demostrar los cuatro callejones + E3 en `36c3897`.
- Inputs: E1–E6.
- Deliverable: checks/table-driven que fallen hoy.
- Gate: rojo en este HEAD; no writers.
- Proof: output de test nombrando cada caso.

### S1 — Handoff honesto

- Objetivo: nunca `execute_task` sin ready; JSON con `blocker`/`remedyCommand`.
- Depende: S0.
- Deliverable: cambios en writers de handoff (`record-evidence`, `active-plan`) + status/context-pack/envelope.
- Gate: S0 casos de routing verdes; finding de routing elevado a HIGH si el handoff miente.
- Proof: `status --json` / `context-pack --json` del fixture.

### S2 — Caso 1

- Objetivo: un `--update-active` corrige requisito + tasks, con remove/cancel in-band.
- Depende: S1.
- Deliverable: extensión de `active-plan.ts` / `plan --update-active`; misma ceremonia digest.
- Gate: evidencia conservada; pass no afectado intacto; doctor limpio.
- Proof: fixture caso 1 verde.

### S3 — Caso 2

- Objetivo: `rule update|remove|replace` local.
- Depende: S1.
- Deliverable: `src/cli/commands/rule.ts` y readers de conventions.
- Gate: pack efectivo sin el id removido; historial local conserva texto viejo.
- Proof: fixture caso 2 verde + doctor.

### S4 — Caso 3

- Objetivo: `plan --roadmap` sobre entradas `planned`.
- Depende: S1.
- Deliverable: parser + writer de roadmap futuro; materialización salta cancelled.
- Gate: `n` closed/active inalterado.
- Proof: fixture caso 3 verde.

### S5 — Caso 4

- Objetivo: `scope discard` orquesta E6.
- Depende: S1, S2 (cancel in-band o dispositions existentes).
- Deliverable: preview de etapas + apply digest/yes; sin nuevo storage protocol.
- Gate: retired + abandoned close; retry de digest; doctor limpio.
- Proof: fixture caso 4 con crash inyectado entre etapas (si el writer existente ya expone seam; si no, retry manual del mismo digest).

### S6 — Skill + doctor

- Objetivo: excepción cargada cuando hay blocker.
- Depende: S1; se engancha a S2–S5 conforme existan.
- Deliverable: helper forge/executor; capabilities/help.
- Gate: proyección clean-HOME; doctor invocado tras write.
- Proof: check de projection + script de helper.

Orden: S0 → S1 → (S2 ∥ S3 ∥ S4) → S5 → S6. S5 prefiere S2 para cancel in-band pero puede usar `record-evidence --disposition` si S2 aún no merged.

## Acceptance and validation matrix

| Outcome / invariante | Escenario | Evidencia | Método |
| --- | --- | --- | --- |
| Caso 1 | Cambiar R1 + AC de T1; T2 pass no consumidor | sprint.json: R1 nuevo, T1 pending sin verdict, T2 pass, evidence de T1 intacta | CLI `--update-active` + doctor |
| Caso 1 remove | Quitar requisito con scenario vivo sin relink | Rechazo, cero writes | CLI |
| Caso 2 | replace process-1 → process-2 | Packs sin process-1; history local con ambos | CLI rule + context-pack |
| Caso 3 | Cancelar sprint planned n=4; n=1 closed intacto | roadmap n=4 cancelled; archive sprint-001 intacto | CLI `--roadmap` + doctor --artifacts |
| Caso 4 | Discard con sprint activo y tasks undisposed | close abandoned + scope retired | CLI discard + inspect |
| E3 | Dispose última unfinished | nextAction ≠ execute_task sin ready | status --json |
| I1 archive | Discard no reescribe checkpoint de un close previo de otro sprint | hashes de archives | doctor --artifacts |
| I6/I7 | Tras S2–S5, schemaVersion 4 y sin dirs de revision/transaction | tree `.agents/kyro` del fixture | ls + schema |

## Forge handoff

- **Scope objetivo:** Permitir cambiar trabajo vigente (requisito+tareas, regla local, roadmap futuro, discard de scope) sin congelarlo ni borrar evidencia ni mentir el handoff.
- **Requirement candidates:**
  - R1 Un `--update-active` agrupa corrección de requisito y tasks actuales, con remove/cancel atómicos respecto a consumidores.
  - R2 `rule update|remove|replace` local deja la regla vieja inefectiva y conserva su texto en historial de scope.
  - R3 `plan --roadmap` muta solo entradas `planned` sin renumerar closed/active.
  - R4 `scope discard` con un consentimiento ejecuta cancel → abandoned close → retire, reanudable por digest.
  - R5 Handoff y JSON nunca anuncian `execute_task` sin ready; exponen `blocker.remedyCommand`.
  - R6 Tras write, doctor (y artifacts si aplica) es la verificación; schema 4.
- **Non-goals:** Plan 15 journal, `--global`, schema 5, ADR/questions/debt cancel, Lens/MCP.
- **Dependencies:** Plan 14 (`--update-active`), close abandoned, scope retire, doctor/repair, writer lock.
- **Orden:** S0, S1, S2/S3/S4 en paralelo, S5, S6.
- **Follow-up no bloqueante:** `debt cancel` si S0 lo exige; `--global` nunca en este scope.

Sugerencia de ejecución: `/kyro:forge change-current-work`.

## Quality gate

| Criterion | Score | Notes |
| ---: | ---: | --- |
| Thesis and causality | 15/15 | Historial congela lo vivo; cuatro frases; workaround vs verbo. |
| Grounding and evidence | 15/15 | E1–E11 con paths de `36c3897`. |
| Clarity and no ambiguity | 15/15 | Live≠archive; verbos nombrados; local≠global. |
| Observable outcomes | 15/15 | 7 pruebas falsificables + falso éxito. |
| Invariants and failures | 10/10 | 8 leyes; tabla empty/partial/invalid/fatal. |
| Decisions and tradeoffs | 10/10 | 7 decisiones con coste. |
| Scope coherence | 10/10 | In = 4 casos + handoff + doctor; out = Plan 15. |
| Executable handoff | 10/10 | S0–S6, R1–R6, orden y forge slug. |
| **Total** | **100/100** | Sin contradicción material. Usuario cerró roadmap / discard / local-only. |

Evidence sources reviewed: `src/cli/core/active-plan.ts`, `src/cli/commands/{plan,rule,adr,debt,record-evidence,scope}.ts`, `src/cli/checkpoints/scope-retirement.ts`, `src/cli/core/{cli-envelope,capabilities}.ts`, `docs/plans/plan-14-active-work-task-editing.md`, conversación 2026-09-17 (base `origin/develop`, tres decisiones). No se leyeron `project.json`, `local.json` ni `scopes/` (idea pre-scope).
