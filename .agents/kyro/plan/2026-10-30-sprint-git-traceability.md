---
docType: plan
date: 2026-10-30
slug: sprint-git-traceability
title: Trazabilidad git por sprint y commit opcional al cierre
maturedFrom: mature
agents: []
---

# Trazabilidad git por sprint y commit opcional al cierre

## Core thesis

Kyro sabe qué se planificó y validó en cada sprint, pero no qué commits lo implementaron; por eso cualquier consumidor (QA, `kyro-qa-assist`, auditoría) tiene que adivinar la relación código↔sprint por archivos y fechas. Registrar de forma determinista el rango git de cada sprint — `startCommit` al planificar y `endCommit` al cerrar, congelado en el checkpoint — convierte esa inferencia en un hecho verificable, y un commit opcional de los artefactos de cierre, marcado con trailers, deja un ancla buscable en git incluso sin Kyro instalado.

## Problem / Motivation

- **Causa:** `LedgerEntry` registra `closedAt`, `archive`, `snapshot` y `checkpoint`, pero ningún commit (`src/cli/types.ts:351-363`). `ActiveSprint` tampoco (`src/cli/types.ts:554-563`).
- **Consecuencia:** `kyro-qa-assist` (registry PR #5) une commits con tareas por coincidencia de archivos y fechas, etiquetado `[Inferred]`; el QA recibe "resultado esperado" con atribución dudosa.
- **Práctica actual manual:** el equipo ya crea commits de cierre a mano (`e82dcba chore(kyro): close global installation sprint 2`, `6875799 chore(work): complete organic-work scope`), sin formato ni metadatos consistentes.
- **Por qué ahora:** el skill de QA ya está publicado y su mayor debilidad declarada es justamente esta unión; el usuario pidió explícitamente el commit al cierre configurable en `local.json` y que la trazabilidad quede registrada.

## Current-state evidence

Observado:

- El cierre es una transacción con checkpoint inmutable `SprintCloseCheckpointV1` (`src/cli/types.ts:410-423`, `SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION = 1`, `src/cli/types.ts:367`) que congela `beforeClose`, `close: SprintCloseInputs`, `createdAt`, rutas e `intendedAfterClose` con digests.
- La verificación del checkpoint **re-deriva** `intendedAfterClose` desde `beforeClose`, `close`, `createdAt` y rutas, y lo compara con `canonicalJson` (`src/cli/checkpoints/sprint-close.ts:282-300`). Todo dato que termine en el ledger debe derivarse de esas entradas.
- La entrada del ledger se construye en `deriveSprintCloseTransitionWithPolicy` desde `active` y `close` (`src/cli/checkpoints/sprint-close.ts:200-222`).
- En un reintento, `retryCloseInputs` reconstruye las entradas desde los argumentos y `assertMatchingCloseInputs` exige igualdad canónica con las congeladas (`src/cli/commands/close-sprint.ts:464-480`, `547-551`).
- El cierre escribe exactamente: checkpoint, snapshot legacy (`archive/*.json`), narrativa (`archive/*.md`), `sprint.json` y `projectScopeWritePath()` (`src/cli/checkpoints/sprint-close.ts:508`); en workspaces por capas `project.json` normalmente no cambia (`:554`).
- CLI (`executeConfirmedClose`, `src/cli/commands/close-sprint.ts:103`) y MCP (`closeSprintTool`, `src/cli/mcp/handlers.ts:~90-130`) comparten `buildClosePlan` y `applySprintCloseTransaction`.
- `activeSprint` se materializa solo en el modo sprint del plan (`buildPlanSprintPlan`, `src/cli/commands/plan.ts:449-485`); el modo init deja `activeSprint: null` (`:398`).
- Los validadores usan el patrón "opcional, validado cuando está presente" y toleran claves desconocidas (`validateLedgerEntry` `src/cli/artifacts/schema.ts:769-787`, `validateActiveSprint` `:804`, `validateLocalProjectStateShape` `:228-255`).
- `local.json` está en `.gitignore` (`.agents/kyro/.gitignore:4`) y su tipo es preferencias personales (`KyroLocalProjectState`, `src/cli/types.ts:187-197`).
- `.agents/kyro/validation.json` marca `src/cli/artifacts/**` y `src/cli/checkpoints/**` como rutas `escalate`: el cierre de los sprints que las toquen exige suite completa.

Hipótesis a confirmar en W1:

- H1: ningún flujo que reescribe `activeSprint` (actualización de plan activo, repair, remediate, recertify) descarta claves desconocidas; si alguno lo hace, `activeSprint.git` debe preservarse explícitamente.
- H2: la verificación de checkpoint en `check:lossless-checkpoints`, `check:replay-witness` y `check:close-policy-compatibility` sigue pasando con checkpoints antiguos sin `close.git`.

## Who it's for

- **QA testers** vía `kyro-qa-assist`: necesitan saber qué código pertenece a cada sprint para derivar el comportamiento esperado.
- **Desarrolladores y agentes** que cierran sprints: quieren el commit de cierre sin hacerlo a mano.
- **Auditoría / Kyro Lens:** rango de commits por sprint visible en `sprint.json`.

Decisiones que habilita: qué rango comparar para un sprint, si el rango es completo (`dirty`), dónde está el commit de cierre.

## What success looks like

1. Tras cerrar un sprint planificado con esta versión, `sprint.json.ledger[n].git` contiene `branch`, `startCommit`, `endCommit` y `dirty`, y `git diff startCommit..endCommit` muestra el código del sprint. **Falso éxito:** `endCommit` capturado después del commit de cierre (incluiría los artefactos) o recapturado en un reintento.
2. Con `git.commitOnSprintClose: true`, el cierre crea un commit que contiene **solo** las rutas escritas por el cierre, con trailers `Kyro-Scope` y `Kyro-Sprint`; `git log --grep "Kyro-Sprint: <n>"` lo encuentra. **Falso éxito:** el commit incluye otros archivos que el usuario tenía en el index o en el árbol.
3. Un fallo del commit nunca deshace ni bloquea el cierre; se informa con el comando manual exacto.
4. Checkpoints y `sprint.json` existentes (sin bloque `git`) siguen validando, verificando y re-derivando igual.
5. `kyro-qa-assist` v1.1 usa el rango registrado cuando existe y degrada a la inferencia actual cuando no.

## Product laws / invariants

| Ley | Fallo que previene |
|---|---|
| `endCommit` = `HEAD` leído en `buildClosePlan` **antes** de escribir nada, congelado en `close.git`; reintentos reutilizan `checkpoint.close.git`, nunca releen `HEAD`. | Rango que incluye el commit de cierre; `CHECKPOINT_CONFLICT` en reintentos |
| El ledger obtiene `git` solo por derivación desde `beforeClose.activeSprint.git` + `close.git`. | Falla de la re-derivación canónica del checkpoint |
| Ausencia de `close.git` y de `activeSprint.git` produce exactamente la derivación actual (sin clave `git`). | Romper checkpoints/archivos históricos |
| Captura git nunca bloquea plan ni cierre: fuera de un repo, repo sin commits, o error de git ⇒ se omite el campo y se informa. | Kyro inutilizable en workspaces sin git |
| El commit automático solo incluye rutas escritas por la transacción de cierre que tengan cambios; otras entradas del index permanecen como estaban. | Commitear trabajo ajeno, secretos o archivos temporales |
| El commit automático corre solo después de `applySprintCloseTransaction` + `verifyWrittenSprint` exitosos, nunca con `--dry-run` ni sin confirmación. | Commit de un cierre no aplicado |
| Nunca `push`, nunca `--no-verify`, nunca `--no-gpg-sign`, nunca `--amend`. | Publicar o eludir políticas del repo |
| Fallo del commit ⇒ sprint cerrado, resultado `failed` con razón y comando manual; nunca rollback. | Estado inconsistente entre Kyro y git |
| Commit automático por defecto desactivado; solo `local.json → git.commitOnSprintClose: true` lo activa. | Cambiar comportamiento a usuarios existentes |
| CLI y MCP producen el mismo efecto y el mismo resultado `commit`. | Divergencia entre superficies |

## Observable success and failure guarantees

| Situación | Captura (`activeSprint.git` / `close.git`) | Commit automático (si activado) |
|---|---|---|
| Repo normal, árbol limpio fuera de `.agents/kyro/` | completa, `dirty: false` | `committed` + SHA |
| Cambios sin commitear fuera de `.agents/kyro/` (tracked o untracked no ignorados) | completa, `dirty: true` + aviso "esos cambios quedan fuera del rango del sprint" | `committed` (solo rutas del cierre) |
| HEAD detached | `branch: null`, commits capturados | `skipped: detached HEAD` |
| Merge, rebase, cherry-pick o revert en curso | capturada | `skipped: <operación> in progress` |
| Repo sin commits (HEAD sin nacer) | omitida (sin clave `git`) | `skipped: no commits` |
| No es repo git / git no instalado | omitida | `skipped: not a git repository` |
| Rutas del cierre ignoradas por git (`diagnoseKyroGitTrackability` = fail) | capturada | `skipped: Kyro state is gitignored` + remedio existente |
| Rutas del cierre sin cambios (cierre reanudado ya commiteado) | — | `skipped: nothing to commit` |
| Hook rechaza, firma falla, otro error de git | capturada | `failed: <stderr resumido>` + comando manual |
| `--dry-run` / MCP sin `confirm` | no se escribe nada | no corre |
| `startCommit` ausente (sprint planificado antes de esta versión) | ledger con `startCommit: null`, resto completo | igual |

## Outcome-based scope

### In

- Bloque opcional `git` en `ActiveSprint`: `{ branch: string | null, startCommit: string }`, capturado en `buildPlanSprintPlan`.
- Campo opcional `git` en `SprintCloseInputs`: `{ branch: string | null, endCommit: string, dirty: boolean }`, capturado en `buildClosePlan` (camino nuevo) y reutilizado desde el checkpoint en reintentos.
- Campo opcional `git` en `LedgerEntry`: `{ branch, startCommit: string | null, endCommit, dirty }`, derivado.
- Sección "Git" en la narrativa del sprint (`archive/*.md`) cuando hay datos.
- Preferencia `local.json → git: { commitOnSprintClose?: boolean }` con validación.
- Commit automático post-cierre en CLI y MCP, con trailers y resultado estructurado (`commit: { status: 'committed'|'skipped'|'failed', sha?, reason?, manualCommand? }`) en la salida JSON del CLI y en el resultado MCP.
- Script de verificación dedicado y entrada en `npm run check`; documentación (`docs/sprint-close-checkpoints.md`, `docs/cli.md`, `docs/spec-traceability.md` o equivalente) y CHANGELOG.
- `kyro-qa-assist` v1.1 (registry): usar `ledger[].git` como unión verificada.

### Explicitly out

- Cierre de Work (`organic-work`): tiene ciclo propio; se evalúa después con la misma forma de datos.
- Política de equipo en `project.json` (forzar el commit para todos): posible siguiente paso, requiere decidir precedencia sobre `local.json`.
- Push, apertura de PR, etiquetado.
- Relleno retroactivo de sprints ya cerrados (inventaría historia; contradice la regla de no fabricar estado histórico de `buildClosePlan`).
- Nuevo tipo de evento de trace para el commit (evita tocar el contrato de trace; el resultado va en la salida del comando).
- Flag de CLI para sobrescribir la preferencia por invocación.
- Commit de `scope complete`.

## Closed decisions with rationale

| Decisión | Razón / evidencia | Tradeoff | Consecuencia |
|---|---|---|---|
| Opción A: el commit solo incluye artefactos del cierre | Elegida por el usuario; evita commitear trabajo ajeno | El código debe commitearse antes de cerrar | Aviso `dirty` cuando no se hizo |
| `endCommit` en `close.git` (entrada congelada) | La re-derivación canónica (`sprint-close.ts:282-300`) y `assertMatchingCloseInputs` exigen que todo dato del ledger provenga de entradas congeladas | `retryCloseInputs` debe copiar `checkpoint.close.git` | Reintentos deterministas; sin bump de schema de checkpoint |
| `startCommit` en `activeSprint.git` al planificar | El primer sprint de un scope no tiene cierre previo; cambios de rama entre sprints | Sprints planificados con versiones viejas quedan con `startCommit: null` | Rango completo solo para sprints nuevos |
| Trazabilidad siempre activa, commit opcional | La trazabilidad no toca git; el commit sí | Un campo más en artefactos | QA tiene rango aunque nadie active el commit |
| Configuración en `local.json` | Pedido del usuario; ya aloja preferencias personales (`execution`) | Inconsistencia posible entre desarrolladores | Política de equipo queda como evolución |
| `git add -- <rutas>` + `git commit --only -- <rutas>` | `--only` no acepta rutas desconocidas por git; `--only` preserva el resto del index | Dos comandos git | Ley "solo rutas del cierre" verificable |
| Trailers `Kyro-Scope` / `Kyro-Sprint` | Un commit no puede contener su propio SHA; los trailers sobreviven a rebase | Búsqueda por texto | Ancla encontrable sin Kyro |
| Mensaje `chore(kyro): close <scope> sprint <n> — <title>` | Sigue el formato manual existente (`e82dcba`) | — | Historial homogéneo |
| `dirty` excluye `.agents/kyro/` | El propio cierre modifica esos archivos | Cambios manuales en `.agents/kyro/` no cuentan | Señal limpia sobre el código |
| Sin nuevo tipo de trace | Minimizar superficie de contrato | Menos auditoría del commit en trace | Resultado visible en la salida del comando |

## Constraints and tradeoffs

- Compatibilidad: `schemaVersion` de `sprint.json` (4) y del checkpoint (1) no cambian; todo es aditivo y opcional.
- Rutas `escalate` tocadas (`src/cli/artifacts/**`, `src/cli/checkpoints/**`): el cierre del sprint de esta implementación exige suite completa.
- Multiplataforma: comandos git con `execFileSync` y argumentos en arreglo (como `src/cli/core/git-trackability.ts`), sin shell; rutas relativas a la raíz del repo; probado en CI Linux y Windows.
- Rendimiento: tres o cuatro invocaciones git por cierre; despreciable.
- Validación del repositorio: runner dirigido por etapa y `npm run check` completo una vez en integración; datos temporales bajo `~/.cache/kyro-tmp`.
- Versión: requiere bump minor (6.5.0) con README.md y `docs/cli.md` actualizados (gate `check:remediation-release-docs`).

## Risks, failure modes and degradation

| Riesgo | Disparador | Impacto | Contención | Señal |
|---|---|---|---|---|
| Re-derivación del checkpoint rompe | `git` añadido al ledger fuera de la derivación | Cierres marcados como corruptos | Derivar solo desde entradas congeladas; tests con checkpoints viejos y nuevos | `check:lossless-checkpoints`, `check:replay-witness` fallan |
| `activeSprint.git` se pierde | Un flujo reescribe `activeSprint` sin claves desconocidas (H1) | `startCommit: null` inesperado | Auditar flujos en W1; test de preservación | Test de plan activo / repair |
| Commit arrastra archivos ajenos | Uso de `git commit` sin `--only` o `add -A` | Publicar trabajo no revisado | `--only` + rutas explícitas; test con index precargado | Test de aislamiento del index |
| Hook lento o interactivo | Pre-commit pesado | Cierre percibido como colgado | Mensaje previo "creando commit…"; stdin cerrado | Tiempo de cierre |
| SHAs inválidos tras rebase/squash | Flujo de merge del equipo | Rango apunta a commits inexistentes | QA skill verifica con `git cat-file -e` y degrada; trailers como respaldo | `cat-file` falla |
| Usuario espera que el commit incluya el código | Malentendido de la opción A | Código sin commitear | Aviso `dirty` explícito y docs | Reportes de usuarios |

## Execution blueprint

1. **W1 — Contrato de datos.** Tipos `ActiveSprint.git`, `SprintCloseInputs.git`, `LedgerEntry.git`, `KyroLocalProjectState.git`; validadores "cuando está presente" (SHA hex 40/64, `branch` string o null, `dirty` boolean, `commitOnSprintClose` boolean); auditoría H1 de todos los escritores de `activeSprint` y ledger. Gate: checks existentes de esquema y estado en verde; test nuevo que valida formas correctas e incorrectas. Prueba: `sprint.json` y `local.json` actuales del repo validan sin cambios.
2. **W2 — Captura en plan.** Helper git de solo lectura (`rev-parse HEAD`, rama simbólica, estado de operación en curso, `status --porcelain` filtrado) reutilizable; `buildPlanSprintPlan` añade `activeSprint.git`. Depende de W1. Gate: `check:plan`, `check:active-plan` + test de preservación tras actualización del plan activo. Prueba: sprint planificado en repo temporal contiene `startCommit` = HEAD.
3. **W3 — Captura en cierre y derivación.** `buildClosePlan` captura `close.git` en el camino nuevo; `retryCloseInputs` copia `checkpoint.close.git`; `deriveSprintCloseTransitionWithPolicy` añade `ledger.git`; narrativa con sección Git. Depende de W1. Gate: `check:lossless-checkpoints`, `check:replay-witness`, `check:close-policy-compatibility`, `check:close-handoff`, `check:verify-written-sprint` + test de reintento con HEAD avanzado (debe conservar `endCommit` original). Prueba: checkpoint nuevo re-deriva idéntico; checkpoint antiguo sigue verificando.
4. **W4 — Commit automático.** Lectura de la preferencia; tras aplicar y verificar, filtrar las rutas de la transacción con cambios, aplicar guardas de la tabla de garantías, `git add -- <rutas>`, `git commit --only -m <mensaje> -- <rutas>`; resultado estructurado en CLI (texto y JSON) y MCP. Depende de W3. Gate: script nuevo `check:sprint-close-git` en repos temporales que cubre cada fila de la tabla de garantías, incluido index precargado con otro archivo, hook que rechaza, HEAD detached y rebase en curso; `check:mcp`, `check:cli-envelope`.
5. **W5 — Documentación y release.** `docs/sprint-close-checkpoints.md`, `docs/cli.md`, guía de `local.json`, CHANGELOG; bump 6.5.0 con README.md/`docs/cli.md`. Depende de W4. Gate: `npm run build` + `npm run check` completo (suite de integración) + `npm pack --dry-run`.
6. **W6 — `kyro-qa-assist` v1.1** (repo `skills-registry`). `assets/sources.md`: unión de fuerza máxima cuando `ledger[].git` existe y ambos SHAs verifican con `git cat-file -e` ⇒ `[Verified in code/git]`; búsqueda por trailers; `dirty: true` y `startCommit: null` como advertencias de cobertura; bump 1.1 en los cuatro archivos de versión del registry. Depende de W5 publicado. Gate: ensayo con un sprint cerrado por esta versión en un repo temporal.

## Acceptance and validation matrix

| ID | Resultado / ley | Escenario | Evidencia | Método |
|---|---|---|---|---|
| A1 | Rango registrado (éxito 1) | Planificar y cerrar un sprint en repo temporal con commits intermedios | `ledger[n].git` con `startCommit`/`endCommit` correctos | `check:sprint-close-git` |
| A2 | `endCommit` antes del commit de cierre | Cierre con commit automático | `endCommit` ≠ SHA del commit de cierre y es su padre | idem |
| A3 | Reintento determinista | Cierre interrumpido, nuevo commit, reintento | `endCommit` original; sin `CHECKPOINT_CONFLICT` | idem |
| A4 | Compatibilidad histórica (éxito 4) | Checkpoints y sprints existentes sin `git` | Validan, verifican y re-derivan sin cambios | checks de checkpoints existentes + fixtures actuales |
| A5 | Solo rutas del cierre (éxito 2) | Index con otro archivo staged y cambios sin commitear | Commit contiene solo rutas del cierre; el otro archivo sigue staged | `check:sprint-close-git` |
| A6 | Trailers | Commit creado | `git log --grep "Kyro-Sprint: <n>"` lo encuentra; trailers parseables con `git interpret-trailers --parse` | idem |
| A7 | Fallo no deshace (éxito 3) | Hook pre-commit que sale con 1 | Sprint cerrado; resultado `failed` + comando manual | idem |
| A8 | Guardas | Detached HEAD, rebase en curso, repo sin commits, no-repo, estado ignorado, nada que commitear | Resultado `skipped` con la razón de la tabla | idem |
| A9 | Desactivado por defecto | Sin preferencia | Ningún commit nuevo; trazabilidad presente | idem |
| A10 | Paridad CLI/MCP | Mismo cierre por MCP con `confirm: true` | Mismo commit y mismo objeto `commit` | `check:mcp` ampliado |
| A11 | `dirty` | Archivo de código sin commitear al cerrar | `dirty: true` + aviso | `check:sprint-close-git` |
| A12 | Preservación de `activeSprint.git` (H1) | Actualización de plan activo / repair sobre sprint con `git` | Bloque intacto | test de W2 |
| A13 | Integración | Repo completo | `npm run check` y `npm pack --dry-run` verdes | W5 |
| A14 | Consumo QA (éxito 5) | `kyro-qa-assist` sobre sprint cerrado con rango | Atribución commit↔sprint etiquetada `[Verified in code/git]` | Ensayo W6 |

## Forge handoff

- **Objetivo del scope:** registrar el rango git de cada sprint y ofrecer un commit opcional de los artefactos de cierre, sin romper la verificación de checkpoints ni el comportamiento existente.
- **Requisitos candidatos:** R1 captura de `startCommit` al planificar; R2 captura congelada de `endCommit` al cerrar; R3 derivación del ledger y compatibilidad histórica; R4 commit automático aislado por rutas con trailers; R5 guardas y fallo no destructivo; R6 paridad CLI/MCP; R7 preferencia validada en `local.json`; R8 documentación y release; R9 consumo en `kyro-qa-assist`.
- **Non-goals:** cierre de Work, política en `project.json`, push/PR, relleno retroactivo, nuevo evento de trace, flag por invocación, commit de `scope complete`.
- **Orden:** W1 → (W2 ∥ W3) → W4 → W5 → W6.
- **Validación de cierre:** los sprints que toquen `src/cli/artifacts/**` o `src/cli/checkpoints/**` escalan a suite completa según `.agents/kyro/validation.json`.
- **Seguimiento no bloqueante:** política de equipo en `project.json`; aplicar el mismo bloque `git` al cierre de Work; mostrar el rango en Kyro Lens; nombre definitivo de la clave (`git.commitOnSprintClose`).

## Quality gate

| Criterio | Puntos |
|---|---:|
| Thesis and causality | 14/15 |
| Grounding and evidence | 15/15 |
| Clarity and no ambiguity | 14/15 |
| Observable outcomes | 14/15 |
| Invariants and failures | 10/10 |
| Decisions and tradeoffs | 10/10 |
| Scope coherence | 9/10 |
| Executable handoff | 9/10 |
| **Total** | **95/100** |

Fuentes revisadas: esta conversación (decisiones del usuario: opción A, `local.json`, registrar trazabilidad), `src/cli/types.ts`, `src/cli/commands/close-sprint.ts`, `src/cli/checkpoints/sprint-close.ts`, `src/cli/commands/plan.ts`, `src/cli/mcp/handlers.ts`, `src/cli/artifacts/schema.ts`, `src/cli/core/git-trackability.ts`, `.agents/kyro/.gitignore`, `.agents/kyro/validation.json`, `package.json`, historial git de commits de cierre manuales. Descuentos: H1/H2 se confirman en W1–W3. Sin contradicciones materiales pendientes.
