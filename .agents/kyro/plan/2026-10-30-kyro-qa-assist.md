---
docType: plan
date: 2026-10-30
slug: kyro-qa-assist
title: kyro-qa-assist — copiloto conversacional de solo lectura para QA testers
maturedFrom: mature
agents: []
---

# kyro-qa-assist — copiloto conversacional de solo lectura para QA testers

## Core thesis

Los QA testers manuales reciben un proyecto cuyo conocimiento (intención, plan, evidencia, historial) está escrito para desarrolladores y agentes; por eso no saben qué cambió, qué puede romperse ni cómo probarlo. `kyro-qa-assist` es un skill opcional y de solo lectura que investiga git, el código y los artefactos de Kyro y traduce ese conocimiento en orientación de pruebas verificable — cada afirmación etiquetada por su nivel de evidencia — mientras el QA conserva toda la autoridad sobre qué probar y qué concluir.

## Problem / Motivation

- **Causa:** Kyro registra por tarea objetivo, criterios de aceptación, archivos, evidencia de validación automática y veredicto, pero en lenguaje técnico y orientado al agente. Nada describe el impacto visible para el usuario ni cómo verificarlo manualmente.
- **Brecha:** el QA (no técnico, no modifica código) debe reconstruir a mano qué cambió entre versiones, qué flujos existentes toca un cambio y qué comportamiento es el esperado. Cuando llega tarde a un proyecto, no tiene por dónde empezar.
- **Consecuencia:** regresiones no detectadas en cambios "internos", pruebas sin oráculo claro (¿bug o comportamiento esperado?), confianza ciega en veredictos automáticos que nunca validaron UI, textos ni experiencia de uso.
- **Por qué ahora:** el equipo pidió explícitamente que Kyro ayude a los QA; Kyro ya tiene trazabilidad R→S→T→evidencia→veredicto y una matriz de verificación honesta, así que el costo marginal es bajo (un skill, sin cambios de runtime).

## Current-state evidence

Observado (fuente):

- Tareas de sprint archivadas contienen `id, title, description, files_to_touch, context, acceptance_criteria, depends_on, scenario_refs, status, evidence, verdict`; la evidencia lista validaciones automáticas y archivos cambiados (`.agents/kyro/scopes/*/archive/*.json`, inspeccionado antes de esta maduración).
- Bloque opcional `spec` con requisitos R*, escenarios Given/When/Then S*, `nonGoals`, `openQuestions` (`docs/spec-traceability.md`, `src/cli/types.ts:508-528`).
- Matriz de verificación de solo lectura con niveles `none|linked|evidence|verdict|unknown` y la nota "Verdict recorded ≠ independent review" (`src/cli/core/verification-matrix.ts`), expuesta vía `kyro analyze --matrix [--json]`.
- Los sprints **no** registran SHAs de commit; solo `closedAt` y archivos en la evidencia (búsqueda en `src/cli/types.ts` y scopes: sin campos de commit). La unión git↔tarea es por tanto inferencial.
- `kyro debt` y `kyro adr` son verbos **solo de mutación** (`kyro debt --help`, `kyro adr --help`); deuda y ADRs se leen de `sprint.json` (`debt[]`, `adrs[]`).
- `kyro context-pack` y `kyro doctor` emiten eventos de trace (`src/cli/commands/context-pack.ts:57`, `src/cli/commands/doctor.ts:124`): no son lecturas puras. `status`, `analyze`, `trace` (sin `--clear`) no escriben; `scope list|inspect` son lecturas (los demás subcomandos de `scope` mutan).
- Planes de `/kyro-idea` en `.agents/kyro/plan/`, briefs de Work en `.agents/kyro/work/*/brief.md`.
- Tags semver con prefijo `v` (`v6.3.0`, `v6.4.0`, `v6.4.1`); `v6.4.0..v6.4.1` = 2 fixes + bump, 13 archivos, +230/−31.
- `skills-registry` es solo contenido: `cognitives/skills/{category}/{name}/` con `SKILL.md` + `manifest.json`, índice `registry.json`, categoría `testing` válida pero aún inexistente, regla de carga perezosa de assets, sin `changelog`/`Version History` en SKILL.md (`../skills-registry/CLAUDE.md`). Precedente: `cognitives/skills/workflow/kyro-pi-sprint-flow` (autor `joicodev`).
- `../kyro-lens` es una UI web de solo lectura que renderiza artefactos de Kyro (`../kyro-lens/README.md`).

Hipótesis (a validar en el ensayo):

- H1: archivos + fechas de `closedAt` bastan para asociar la mayoría de commits de un rango con sus tareas.
- H2: los escenarios S* y criterios de aceptación son convertibles en casos de prueba manuales útiles sin información adicional.

## Who it's for

- **Primario:** QA tester manual, no desarrollador, con acceso al repositorio y a un agente (Claude, Codex, etc.). Decisiones que debe poder tomar: qué probar primero, qué regresión ejecutar, si un comportamiento es defecto o esperado, cómo reportarlo, cuándo su cobertura es suficiente.
- **Secundario:** QA que se incorpora tarde a un proyecto (necesita entender flujos y por dónde empezar); líder de QA (prioriza por riesgo); desarrolladores (reciben reportes reproducibles y trazables).
- **No es para:** quien certifica o audita código (eso es `/kyro-qa`), ni para ejecutar o planificar sprints.

## What success looks like

1. Ante "¿qué cambió entre A y B?" el QA recibe cambios agrupados en nuevo / modificado / eliminado / corrección / interno-sin-efecto-visible, en lenguaje funcional, con fuente y etiqueta de evidencia. **Falso éxito detectable:** una lista de commits o archivos reetiquetada; la respuesta no separa efecto funcional de cambio técnico.
2. Ante "¿qué pruebo?" recibe escenarios priorizados por riesgo con precondiciones, pasos, resultado esperado y su oráculo (de dónde sale lo esperado). **Falso éxito:** casos genéricos aplicables a cualquier app, o resultados esperados sin fuente.
3. Ante un comportamiento observado, el skill contrasta versión anterior, plan e intención, formula hipótesis rotuladas y produce un reporte reproducible. **Falso éxito:** el skill dictamina "es un bug" o "funciona" sin que el QA lo decida.
4. Cero efectos laterales: `git status` y el trace de Kyro idénticos antes y después de una sesión.
5. Degradación honesta: en un repo sin `.agents/kyro/` el skill sigue siendo útil y declara la ausencia de intención documentada.

## Product laws / invariants

| Ley | Fallo que previene |
|---|---|
| Solo lectura con **allowlist**: `kyro status`, `kyro scope list`, `kyro scope inspect`, `kyro analyze [--matrix] --json`, `kyro trace` (sin `--clear`), y git de lectura (`log`, `diff`, `show`, `tag`, `branch`, `blame`, `rev-parse`, `merge-base`). Todo lo demás prohibido. | Mutar estado de Kyro o del repo (una denylist omitiría `context-pack`/`doctor`, que escriben trace) |
| Nunca afirmar "probado", "funciona", "aprobado" ni emitir veredicto de release. | Que el QA confunda análisis con prueba |
| Toda afirmación material lleva etiqueta: `[Verificado en código/git]`, `[Declarado en el plan]`, `[Registrado por Kyro: veredicto automático]`, `[Inferido]`, `[Desconocido]`. | Riesgos hipotéticos presentados como defectos confirmados |
| Un veredicto registrado por Kyro nunca se presenta como validación manual; se señala qué no cubrió (UI, textos, a11y, i18n, permisos por rol, compatibilidad). | Confianza ciega en evidencia automática |
| La unión commit↔tarea se marca `[Inferido]` salvo coincidencia exacta en git. | Trazabilidad falsa por ausencia de SHAs |
| Responde en el idioma del QA; las etiquetas se traducen. | Barrera de lenguaje para no técnicos |
| `nonGoals` y deuda abierta se citan como contexto, no como excusa para descartar un hallazgo. | Que el skill decida por el QA qué no reportar |
| El QA puede rechazar o modificar cualquier recomendación; el skill no insiste ni recalcula para imponer su criterio. | Pérdida de autoridad del QA |

## Observable success and failure guarantees

- **Éxito (Kyro completo):** combina git + CLI de lectura + artefactos; cita tarea/escenario/archivo.
- **Datos parciales (artefactos sin CLI, o CLI de otra versión):** lee `sprint.json` y archivos de `archive/`, `plan/`, `work/` directamente y lo declara.
- **Sin Kyro (solo git + código):** responde desde diff, log y código; todo "esperado" queda `[Inferido]` y lo dice al inicio.
- **Rango vacío o ref inexistente:** informa refs válidas cercanas (tags/ramas) y pide una; no inventa cambios.
- **Pregunta ambigua ("¿qué cambió?" sin rango):** propone el rango por defecto (último tag → HEAD, o merge-base con la rama principal) y lo confirma.
- **Diff demasiado grande:** resume por módulo primero y profundiza bajo demanda; declara qué no leyó.
- **Comando no permitido o fallo del CLI:** no reintenta con verbos de escritura; degrada al siguiente nivel.

## Outcome-based scope

### In

- Skill `kyro-qa-assist` en `skills-registry/cognitives/skills/testing/kyro-qa-assist/` instalable con `npx skills add`.
- `SKILL.md`: rol, leyes, detección de nivel (tier), ciclo de investigación (delimitar rango → hechos git → intención Kyro → cruce → respuesta etiquetada), tabla de carga de referencias por tipo de pregunta, formatos de respuesta.
- `references/`: `sources.md` (mapa de fuentes y allowlist), `oracles.md` (FEW HICCUPPS sobre fuentes Kyro/git), `regression.md` (RCRCRC, riesgo impacto×probabilidad, impacto indirecto), `test-design.md` (equivalencia, valores límite, transición de estados, tablas de decisión, pairwise, cartas exploratorias, precondiciones ocultas), `defect-report.md` (plantilla reproducible, severidad vs prioridad, confirmación vs regresión).
- `manifest.json` y entrada en `registry.json` (category `testing`, providers del registry).
- Ensayo documentado sobre este repo y sobre un repo sin Kyro.

### Explicitly out

- Cambios en el CLI o runtime de kyro-ai (diferido: ver Forge handoff).
- Estado persistido, registro de sesiones, carpeta de salida propia (convertiría el skill en gestor de QA).
- Playwright / regresión visual automática (requiere app levantada; diferido).
- Exportación a Jira/TestRail e integración con trackers (diferido; IDs de issue solo si aparecen en commits).
- Proyección por `kyro install` (decisión: opcional vía registry).

## Closed decisions with rationale

| Decisión | Razón / evidencia | Tradeoff | Consecuencia |
|---|---|---|---|
| Nombre `kyro-qa-assist` | Decisión del usuario; evita confusión con `/kyro-qa` (auditor técnico) | Nombre largo | Descripción debe explicitar "para QA testers manuales" |
| Distribución opcional vía `skills-registry` | Decisión del usuario; no todos los usuarios de Kyro son QA | No recibe `{{KYRO_CLI}}` ni `runtimeVersion` de la proyección | Debe descubrir `kyro` en PATH y tolerar su ausencia o versión distinta |
| Funciona sin `.agents/kyro/` | Decisión del usuario; QA puede trabajar en repos sin Kyro | Menor precisión del oráculo | Tres niveles con degradación declarada |
| Responde en el idioma del QA | Decisión del usuario | Contenido del skill en inglés + traducción en runtime | Etiquetas definidas como conceptos, no literales |
| Conversacional, sin modos | Rediseño acordado: modos rígidos rechazados | Menos estructura fija | Referencias cargadas por intención de la pregunta |
| Allowlist, no denylist | `context-pack`/`doctor` escriben trace; `debt`/`adr` mutan | Menos datos (sin context-pack) | Deuda/ADRs leídos de `sprint.json` |
| MVP sin código en kyro-ai | Minimizar acoplamiento; validar valor primero | Cruce git↔tarea inferido por el modelo | `kyro changes` queda como evolución medida por el ensayo |
| Kyro Lens complementario, sin integración | Lens es UI de lectura; skill es investigación | Dos herramientas | El skill puede sugerir revisar evidencia en Lens |
| Ejecución directa del blueprint, no Forge | Trabajo de contenido en otro repo; Forge en kyro-ai no gobierna `skills-registry` | Sin gates formales de Kyro | Validación por el ensayo y la matriz de aceptación |

## Constraints and tradeoffs

- Convenciones de `skills-registry`: frontmatter con `name, description, license, metadata(author, version, scope, auto_invoke), allowed-tools`; sin `changelog` ni `Version History`; tabla de carga perezosa con columna "Do NOT Read" obligatoria; `description` del manifest ≤ 100 caracteres; máx. 10 tags.
- `allowed-tools: Read, Bash, Glob, Grep` (sin Write/Edit).
- Multi-proveedor: instrucciones neutrales al host; no depender de herramientas propias de Claude.
- Costo de contexto: diffs grandes se resumen por módulo; referencias cargadas solo cuando la pregunta lo requiere.
- Compatibilidad: verbos y formas JSON del CLI pueden variar por versión; el skill trata salidas no parseables como degradación a lectura directa de archivos.

## Risks, failure modes and degradation

| Riesgo | Disparador | Impacto | Prevención / contención | Señal observable |
|---|---|---|---|---|
| Cruce git↔tarea erróneo | Sin SHAs; archivos compartidos entre tareas | Plan de pruebas mal atribuido | Etiqueta `[Inferido]`, mostrar base de la inferencia | El ensayo mide aciertos de asociación |
| Sobreconfianza del QA | Respuestas fluidas | Pruebas omitidas | Leyes de lenguaje + sección "qué no sé / qué no se verificó" | Revisión del ensayo: ninguna frase "probado/funciona" |
| Efecto lateral accidental | Agente usa verbo no permitido | Muta estado o trace | Allowlist explícita; comprobación antes/después en ensayo | `git status` / trace distintos |
| Respuestas genéricas | Poco contexto o pregunta vaga | Valor nulo | Exigir anclaje a cambios concretos; preguntar rango | Casos sin fuente en el ensayo |
| Diff enorme | Rangos largos | Costo/latencia, lectura parcial | Resumen por módulo, declarar cobertura de lectura | Respuesta indica qué no leyó |
| Deriva de versión del CLI | Skill del registry vs kyro instalado | Comandos fallan | Degradación a lectura de archivos | Mensaje de degradación |

## Execution blueprint

1. **W1 — Borrador del skill.** Entradas: este plan, `../skills-registry/CLAUDE.md`, precedente `kyro-pi-sprint-flow`. Entregables: `SKILL.md` + 5 referencias + `manifest.json` en `cognitives/skills/testing/kyro-qa-assist/`. Gate: frontmatter y regla de carga perezosa conformes; allowlist literal presente; sin herramientas de escritura. Prueba de cierre: revisión contra la tabla de leyes.
2. **W2 — Ensayo con Kyro completo** (depende de W1). Sobre kyro-ai, en una sesión nueva con el borrador cargado, actuar como QA con el guion: (a) "¿qué cambió entre v6.4.0 y v6.4.1?", (b) "¿cómo verifico que el fix de ingesta de briefs en Windows quedó resuelto y qué regresión corro?", (c) "¿qué cambió entre v6.3.0 y v6.4.0 y qué pruebo?", (d) un hallazgo simulado ("al cerrar un sprint pequeño no me pidió la validación completa, ¿es un bug?"), (e) "¿qué más debería probar antes de cerrar?". Capturar `git status --porcelain` y `kyro trace --tail 5 --json` antes y después. Gate: matriz de aceptación A1–A6.
3. **W3 — Ensayo sin Kyro** (depende de W1). Repo sin `.agents/kyro/` (p. ej. `../skills-registry`). Gate: A7.
4. **W4 — Ajustes** (depende de W2, W3). Corregir hallazgos del ensayo; registrar en el plan de seguimiento si H1/H2 fallan y si `kyro changes` se justifica.
5. **W5 — Registro** (depende de W4). Entrada en `registry.json`, tabla del README y lista de `CLAUDE.md` del registry; commit en `skills-registry` solo con aprobación del usuario.

## Acceptance and validation matrix

| ID | Resultado / ley | Escenario | Evidencia requerida | Método |
|---|---|---|---|---|
| A1 | Comprensión de cambios (éxito 1) | Guion (a) y (c) | Respuesta separa funcional/técnico/indirecto; identifica los 2 fixes de v6.4.1 | Comparar con `git log`/`git diff --stat` del rango |
| A2 | Recomendación de pruebas (éxito 2) | Guion (b) y (c) | Casos con precondición, pasos, esperado y oráculo citado; distingue confirmación de regresión | Revisión manual del ensayo |
| A3 | Asistencia en hallazgo (éxito 3) | Guion (d) | Contraste versión anterior/plan/intención, hipótesis etiquetadas, reporte reproducible, sin dictamen | Revisión manual |
| A4 | Cero efectos laterales (éxito 4, ley allowlist) | Toda la sesión W2 | `git status --porcelain` y trace idénticos antes/después | Diff de capturas |
| A5 | Etiquetas de evidencia (ley) | Todas las respuestas | Cada afirmación material etiquetada; ninguna "probado/funciona/aprobado" | Búsqueda en la transcripción |
| A6 | Honestidad sobre veredictos automáticos | Guion (b)/(e) | Señala qué no cubrió la evidencia automática | Revisión manual |
| A7 | Degradación sin Kyro (éxito 5) | W3 | Declara ausencia de intención documentada; sigue respondiendo desde git | Revisión manual |
| A8 | Conformidad del registry | W1/W5 | Frontmatter, manifest ≤100 car., categoría `testing`, entrada en `registry.json` | Lectura de archivos |
| A9 | Idioma | Pregunta en inglés y en español | Respuesta en el idioma de la pregunta | Revisión manual |

## Forge handoff

No se recomienda Forge para el MVP (trabajo de contenido en `skills-registry`, fuera del alcance de gobierno de kyro-ai). Si se decide gobernarlo:

- **Objetivo de scope:** publicar `kyro-qa-assist` validado por ensayo.
- **Requisitos candidatos:** R1 comprensión de cambios etiquetada; R2 recomendaciones de prueba con oráculo; R3 asistencia en hallazgos sin dictamen; R4 solo lectura por allowlist; R5 tres niveles de degradación; R6 idioma del QA; R7 conformidad con registry.
- **Non-goals:** cambios de CLI, estado persistido, Playwright, exportaciones, proyección por `kyro install`.
- **Orden:** W1 → (W2 ∥ W3) → W4 → W5.
- **Seguimiento no bloqueante (evolución, cada uno con aprobación aparte):** comando de lectura `kyro changes --from <ref> --to <ref> --json` (unión determinista commit→archivo→tarea→escenario→deuda) si H1 falla; registrar `HEAD` en `close-sprint`; notas de sesión opcionales; comparación visual entre versiones; integración con trackers; autor del manifest (`joicodev` según precedente vs `synapsync`).

## Quality gate

| Criterio | Puntos |
|---|---:|
| Thesis and causality | 14/15 |
| Grounding and evidence | 14/15 |
| Clarity and no ambiguity | 14/15 |
| Observable outcomes | 14/15 |
| Invariants and failures | 9/10 |
| Decisions and tradeoffs | 10/10 |
| Scope coherence | 9/10 |
| Executable handoff | 9/10 |
| **Total** | **93/100** |

Fuentes revisadas: esta conversación (decisiones del usuario), `docs/spec-traceability.md`, `src/cli/types.ts`, `src/cli/core/verification-matrix.ts`, `src/cli/commands/{analyze,context-pack,doctor,scope,status,trace}.ts`, `src/cli/adapters/command-skills.ts`, ayuda de `kyro scope|debt|adr|analyze`, tags git, `../skills-registry/CLAUDE.md`, `../skills-registry/registry.json`, `kyro-pi-sprint-flow`, `../kyro-lens/README.md`. Descuentos: unión git↔tarea y utilidad de S* como casos (H1/H2) solo se prueban en el ensayo. Sin contradicciones materiales pendientes.
