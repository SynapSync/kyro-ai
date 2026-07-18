# Análisis / Decisión — Review por-tarea vs review por-fase (Falla #2)

> **Estado:** DIFERIDO para revisión posterior. Documento interno (no se publica a npm — no está en `package.json.files[]`).
> **Fecha:** 2026-07-18. **Recomendación actual:** mantener review **por-tarea**; NO implementar el review agrupado como default.

## Qué es "Falla #2"

En el diagnóstico de consumo de tokens (`ANALISIS-CONSUMO-TOKENS.md`, O-optimización "Falla #2"),
se propuso **agrupar el review a nivel de fase o sprint** para trabajo de bajo riesgo, en vez de
correr la ceremonia completa de review por cada tarea.

## Cómo funciona hoy (por-tarea) vs cómo funcionaría (por-fase)

**Hoy — por tarea.** Por cada tarea:
1. Ejecuta la tarea
2. `kyro record-evidence`
3. `kyro review` → corre tests → verdict pass/fail
4. Siguiente tarea

→ 7 tareas = **7 reviews + 7 corridas de tests**.

**Con Falla #2 — por fase.** El agente ejecuta todas las tareas de la fase seguidas:
1. Tarea 1 → `record-evidence`
2. Tarea 2 → `record-evidence`
3. … (sin review entre medias)
4. **Un solo `review` de fase → corre tests UNA vez → verdict del bloque**

→ 7 tareas = **1 review + 1 corrida de tests** (por fase). El agente decidiría *qué* tareas
agrupar (solo las triviales/bajo riesgo); las riesgosas seguirían con review por-tarea.

## El matiz de costo (por qué el valor bajó)

El costo recurrente tiene DOS dimensiones:

| Dimensión | Qué la ataca | Estado |
|-----------|--------------|--------|
| **Tamaño** de cada corrida de tests | Guía "acota tests al área tocada, no re-corras la suite" | **YA HECHO en B (v4.21.0)** |
| **Número** de corridas | Agrupar review por fase (Falla #2) | Pendiente |

- El **modo review en sí es barato** (~996 tokens de ceremonia, medido en la auditoría forense de Codex).
  Agrupar ahorra poco por el lado de la ceremonia.
- Lo caro eran **los tests que cada review dispara** (~10.6K tokens/corrida en el caso medido).
- Como **B ya bajó el tamaño** de cada corrida (tests solo del área tocada), el ahorro marginal de
  Falla #2 (que ataca el *número* de corridas) **es menor de lo que era cuando se propuso.**

## El problema serio: rompe la granularidad por-tarea

El review agrupado choca con el **corazón del diseño maker/checker de Kyro**, que es por-tarea:

- Evidencia por-tarea (`record-evidence`, O3).
- Verdict por-tarea (`kyro review`).
- La compuerta determinista `collectCheckerFindings` **opera por-tarea** (cobertura de criterios,
  evidencia, self-review, principios non-negotiable).

Un review por fase tendría que, o bien verificar cada tarea igual (no ahorra nada), o **perder el
gate por-tarea** → si el bloque falla, no sabes *qué* tarea lo rompió (hoy lo sabes al instante).

Además, agrupar exige que **el agente juzgue** "¿estas tareas son bajo riesgo para agrupar?". Un
agente débil juzga mal — justo el modo de fallo que toda esta ronda de mejoras busca eliminar
(quitarle decisiones al agente, no dárselas).

## Opinión / decisión

**Quedarse con review por-tarea. Descartar Falla #2 como default** (a lo sumo, dejarla como opción
manual explícita para quien la pida — nunca automática).

Regla mental:
> Por-fase optimiza **turnos**. Por-tarea optimiza **confiabilidad**. Kyro vende confiabilidad
> (maker/checker determinista). No la cambies por unos turnos.

## Alternativa mejor para el costo de tests (sin romper granularidad)

El problema real es "cuántos tests re-corridos", no "cuántos reviews". Se ataca sin tocar la
granularidad:
1. Mantener la guía de B (tests solo del área tocada) — ya hecho.
2. Con dientes (idea futura): que `record-evidence`/`review` **sugieran/exijan** correr solo los
   tests que cubren los `files_changed` de esa tarea, no toda la suite. Enforcement, portable,
   conserva "una tarea, un veredicto".

## Contexto de lo ya hecho (para no re-litigar)

Ya bajamos el gasto por los lados correctos, sin sacrificar el gate:
O1/O7 (lectura vía context-pack), O6 (review_task tool_owned), **B** (guard de búsquedas +
guía de tests acotados), Falla #3 (sesión fresca en close), O3 (`record-evidence` tool-owned),
O5 (compuerta de clarificación portable). Ver `CHANGELOG.md` v4.20.1→v4.26.0.

## Para revisar más adelante
- ¿El review por-tarea sigue siendo un costo real *medible* tras B? (necesita datos de una corrida real).
- Si sí: implementar la alternativa (tests acotados a `files_changed`) en vez del review agrupado.
- Reconfirmar que la ceremonia de review no creció con O3/O5.
