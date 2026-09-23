---
title: 'instalacion-global-sin-npx — Sprint 1: Actualización global segura y migración'
date: '2026-09-23'
scope: 'instalacion-global-sin-npx'
sprint: 1
slug: 'actualizacion-global-segura'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 1: Actualización global segura y migración

> Closed: 2026-09-23
> Outcome: shipped

## Objective

Hacer que kyro update use npm global con procedencia verificada, sin fallback interno a npx, y que diagnostique migración y fallos parciales sin anunciar éxito falso.

## Definition of Done

- Todas las tareas del Sprint 1 tienen evidencia y veredicto aprobatorio.
- Las pruebas dirigidas de actualización, invocación y runtime proyectado pasan en los entornos disponibles.
- No queda una rama de actualización interna que ejecute npx ni un caso conocido de éxito con versiones divergentes.

## Phases

### P1 — Procedencia del comando activo

> Determinar si el kyro que ejecutará el usuario pertenece al paquete npm global gestionado.

#### T1.1: Clasificar binario npm, ajeno, ausente y ambiguo

**Status**: done

**Description**: Extender la resolución de invocación para comparar el comando kyro efectivo en PATH con la instalación global de npm que usaría update. Distinguir una instalación npm propia de shims pnpm, otros prefijos, ausencia de global y rutas que no puedan validarse. Mantener la detección de binarios efímeros y la invocación de agentes en Windows.

**Evidence**:
- Summary: Clasificación de propiedad npm del kyro efectivo frente al prefijo y root globales; distingue npm propio, gestor/prefijo ajeno, ausencia y rutas ambiguas con soporte de shims Windows.
- Validation: npm run build: pass
- Validation: npm run check:invocation: pass
- Validation: npm run check:update: pass
- Validation: git diff --check: pass
- Files changed: `src/cli/invocation.ts`, `src/cli/commands/update.ts`, `scripts/check-invocation.mjs`, `scripts/check-update.mjs`

**Verdict**: pass

---
### P2 — Actualización global y postcondiciones

> Actualizar desde el paquete npm nuevo, verificar versiones y reportar fallos parciales.

#### T1.2: Retirar la rama npx del actualizador

**Status**: done

**Description**: Modificar el plan y la ejecución de kyro update para que la única vía automática soportada sea npm global. Cuando el binario global no exista o no pertenezca a npm, mostrar instalación/migración o bloqueo accionable antes de descargar. Conservar consulta de registro, confirmación, --check y --dry-run; no ejecutar npx en ningún camino de update.

**Evidence**:
- Summary: El plan y la ejecución de update solo usan npm global verificado; sin comando global, con propiedad ajena/ambigua o registro no verificable ofrecen diagnóstico sin instalación. Refresh usa CLI global fresco.
- Validation: npm run build: pass
- Validation: npm run check:update: pass
- Validation: npm run check:invocation: pass
- Validation: git diff --check: pass
- Files changed: `src/cli/commands/update.ts`, `scripts/check-update.mjs`

**Verdict**: pass

---
#### T1.3: Verificar versión efectiva y fallo parcial

**Status**: done

**Description**: Después de npm install global, comprobar que el paquete nuevo existe con la versión objetivo, que el kyro efectivo resuelve a esa instalación y que el runtime sincronizado tiene la misma versión. Diferenciar error de instalación, ruta/versión divergente y sync fallido; no imprimir éxito total en ninguno de ellos y entregar un remedio basado en la ruta verificada.

**Evidence**:
- Summary: Replaced the update planner's plain invariant Error with KyroCoreError INTERNAL and an actionable diagnostic remedy; preserved the prior package, visible-command, and runtime verification logic.
- Validation: npm run build: PASS
- Validation: npm run check: PASS end-to-end, including check:mcp, check:invocation, check:update, and check:cli-bundle
- Validation: git diff --check: PASS
- Validation: kyro doctor --artifacts --kyro-scope instalacion-global-sin-npx: PASS
- Files changed: `src/cli/commands/update.ts`
- Notes: QA4 full-check failure corrected; no dedicated test added because the invariant branch is unreachable through valid UpdateFacts, while check:mcp directly enforces typed CLI errors.

**Verdict**: pass

---
### P3 — Migración y protección de estado

> Probar el paso de instalaciones temporales al comando npm global sin alterar scopes ni romper el runtime proyectado.

#### T1.4: Cubrir migración de runtime proyectado y casos de invocación

**Status**: done

**Description**: Crear o adaptar pruebas con un usuario que tiene el runtime proyectado pero no kyro global, luego instala el paquete npm y sincroniza desde un proyecto existente. Comparar archivos de estado y scopes antes y después; comprobar que el runtime proyectado sigue rechazando install/sync y que las invocaciones persistidas funcionan en POSIX y Windows.

**Evidence**:
- Summary: Fixture POSIX empaqueta e instala Kyro con npm en prefijo temporal, sincroniza desde proyecto con runtime proyectado y compara estado/scopes; solo cambia installedAt del adaptador local. Runtime proyectado sigue rechazando install/sync y pruebas de invocación Windows simuladas pasan.
- Validation: npm run check:update: pass; previews sin install/escritura
- Validation: npm run check:invocation: pass; shims Windows simulados y rutas efímeras
- Validation: npm run check:cli-bundle: pass; migración npm real en POSIX, preservación de estado y bloqueo de runtime proyectado
- Validation: git diff --check: pass
- Files changed: `scripts/check-update.mjs`, `scripts/check-invocation.mjs`, `scripts/check-cli-bundle.mjs`
- Notes: El fixture npm global real se ejecuta en POSIX; Windows se cubre mediante pruebas puras de .cmd y self-spawn, sin runner Windows disponible en este entorno.

**Verdict**: pass

---

## Unfinished work

_None — every task is done with a passing verdict._

## Learnings

_No learnings recorded._

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 2

_None recorded._
