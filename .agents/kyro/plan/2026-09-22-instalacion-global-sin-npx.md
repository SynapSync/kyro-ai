---
docType: plan
date: 2026-09-22
slug: instalacion-global-sin-npx
title: Instalacion global de Kyro sin dependencia de npx
maturedFrom: mature
agents: []
---

# Instalación global de Kyro sin dependencia de npx

## Core thesis

Quien usa el CLI de Kyro necesita instalar una vez un comando permanente y actualizarlo con `kyro update`; depender de `npx` para crear o refrescar el runtime deja dos instalaciones con capacidades distintas y hace difícil saber qué versión está ejecutándose. El flujo oficial debe partir del paquete global de npm, comprobar que el comando activo pertenece a esa instalación y refrescar el runtime desde el paquete recién instalado.

## Problem / Motivation

El flujo documentado comienza con `npx kyro-ai@latest install`. `npx` ejecuta un paquete temporal; Kyro proyecta de él `~/.agents/kyro/current`, que contiene el CLI de uso diario pero no es un paquete fuente válido para `install` o `sync`. El usuario que ve Kyro instalado puede razonablemente esperar un comando permanente y una actualización coherente. Hoy el actualizador alterna entre npm global y `npx` según encuentre un binario duradero, sin comprobar qué gestor lo instaló. Una instalación global hecha con pnpm puede disparar una actualización en npm y dejar el comando visible apuntando a otra versión.

La petición explícita es dejar de usar `npx` en la instalación oficial y usar una instalación global con npm o pnpm. El análisis previo recomendó npm global como primera vía oficial, con pnpm diferido hasta tener una actualización segura; el usuario aceptó esa dirección.

## Current-state evidence

- `package.json` publica `kyro` y `kyro-ai` desde `dist/cli.js`; el paquete ya admite un binario global.
- `docs/getting-started.md` recomienda `npx kyro-ai@latest` para instalar y sincronizar y explica que esa ejecución no deja un `kyro` permanente en `PATH`.
- `src/cli/package-root-mode.ts` impide ejecutar `install` y `sync` desde el runtime proyectado; requiere el paquete completo.
- `src/cli/commands/update.ts` planifica `npm install -g` si encuentra un `kyro` duradero y `npx -y` en caso contrario; después de la instalación npm busca el CLI nuevo mediante `npm root -g`.
- `src/cli/invocation.ts` distingue rutas temporales de `npx` de un binario duradero, pero no identifica el gestor propietario del binario.
- `scripts/check-update.mjs` verifica ambas ramas actuales y tendrá que validar el contrato nuevo.
- README, guías, mensajes de diagnóstico, skills y pruebas aún contienen instrucciones operativas con `npx` (por ejemplo `README.md`, `agents/orchestrator.md`, `internal/skills/sprint-forge/SKILL.md`, `src/cli/commands/doctor.ts`). Las referencias históricas en changelog o documentos de planes anteriores son contexto, no instrucciones vigentes.
- npm documenta `npm install -g <package>` como instalación de herramientas locales permanentes: https://docs.npmjs.com/downloading-and-installing-packages-globally/ . npm documenta `npx`/`npm exec` como ejecución con paquetes obtenidos para el proceso: https://docs.npmjs.com/cli/v11/commands/npm-exec/ . pnpm admite `pnpm add -g`, con ubicación y binarios propios: https://pnpm.io/cli/add y https://pnpm.io/global-packages .

## Who it's for

Usuarios del CLI en equipos y máquinas personales: necesitan saber cómo instalar, actualizar y verificar Kyro sin conocer la distinción interna entre paquete y runtime. Mantenedores: necesitan un contrato de actualización, migración y pruebas que no anuncie soporte inexistente. Usuarios exclusivos del plugin de Claude Code conservan su vía de plugin; si necesitan el CLI, siguen la instalación global.

## What success looks like

1. Una instalación nueva documentada usa `npm install -g kyro-ai@latest`, seguida de `kyro install --scope workspace --init-workspace --yes` desde la raíz del proyecto. `kyro --version` y `kyro doctor` funcionan en una terminal nueva.
2. `kyro update --check` y `--dry-run` describen exclusivamente la vía global de npm o una migración necesaria, sin prometer una actualización que cambie otro binario. `kyro update` instala la versión objetivo, verifica el paquete nuevo y el comando activo, y sincroniza el runtime desde ese paquete.
3. Si el comando visible pertenece a pnpm, otro prefijo de npm o una ruta ambigua, Kyro no reporta éxito tras actualizar una instalación distinta; muestra la discrepancia y una solución concreta.
4. Quien solo tiene el runtime proyectado puede migrar una vez a npm global sin perder el estado del proyecto; no se invoca `npx` como mecanismo interno de actualización.
5. La documentación vigente, ayudas, diagnósticos y skills muestran un camino coherente. Las pruebas detectan una regresión de versión visible, ruta activa o mezcla de gestores; `npm pack --dry-run` incluye el CLI y los recursos necesarios.

## Product laws / invariants

- El runtime proyectado no se convierte en fuente de `install`/`sync`; evita copiar un paquete incompleto.
- El actualizador no declara éxito hasta que el paquete usado para sincronizar y el `kyro` que resolverá `PATH` corresponden a la versión objetivo; evita éxito falso con gestores o prefijos mezclados.
- El paquete se instala antes de refrescar el runtime y la sincronización se ejecuta desde el paquete nuevo; evita proyectar archivos de la versión anterior.
- `--check` y `--dry-run` no instalan ni modifican nada; evitan sorpresas en automatizaciones.
- Una migración no borra ni reescribe scopes para obtener un comando global; evita pérdida de trabajo de proyecto.
- En Windows se conserva una invocación durable ejecutable por los agentes, aunque el bootstrap sea global; evita depender de lanzar directamente un shim `.cmd` desde Node.
- Se mantiene la detección defensiva de ejecutables temporales de `npx` o `dlx` para que nunca se persistan como comandos duraderos, aunque ya no sean una vía recomendada.

## Observable success and failure guarantees

- **Instalación válida:** binario global verificable, paquete completo y runtime sincronizado; se imprime versión y siguientes pasos.
- **Sin paquete global:** `update` y diagnósticos explican la instalación/migración con npm; no ejecutan `npx` ocultamente.
- **Gestor o prefijo no reconocido:** se bloquea la actualización automática antes de instalar en otra ubicación; `--check`/`--dry-run` muestran el motivo.
- **Registro inaccesible:** el chequeo informa que no pudo confirmar la versión; una actualización explícita conserva el tratamiento actual del error de red, sin usar un gestor alternativo silencioso.
- **Instalación incompleta o fallo de sincronización:** se informa qué paso tuvo éxito y cuál falló, sin afirmar que Kyro está actualizado; el remedio usa una ruta del paquete verificada.
- **Plugin sin CLI:** el plugin sigue pudiendo operar según su contrato vigente; las instrucciones para obtener el CLI apuntan a npm global.

## Outcome-based scope

### In

- Nuevo recorrido oficial de instalación, migración y actualización con npm global.
- Verificación de propiedad/ruta y versión del comando activo antes y después de actualizar.
- Retiro de la rama interna `npx` del actualizador y de las instrucciones operativas vigentes; adaptación de las pruebas correspondientes.
- Conservación del runtime proyectado y de la compatibilidad de invocación multiplataforma.

### Explicitly out

- Soporte oficial de instalación/actualización global mediante pnpm en esta entrega: requiere reconocimiento de propiedad y un flujo de actualización propio, que hoy no existen.
- Bloquear técnicamente que terceros ejecuten `npx kyro-ai`: el paquete publicado con `bin` seguirá permitiéndolo; no es necesario para eliminar la dependencia interna.
- Reescribir documentos históricos que describen correctamente ejecuciones pasadas.
- Cambiar el formato de `sprint.json`, scopes o estado de proyecto: el problema está en distribución e invocación del CLI.

## Closed decisions with rationale

1. **npm global será la vía oficial inicial.** Ya es la rama global implementada y coincide con el gestor usado por `update`; limita el primer cambio y da un comando durable. El coste es que usuarios de pnpm deben usar npm para el CLI de Kyro hasta que exista soporte propio.
2. **pnpm no se interpretará como npm por tener un binario durable.** La propiedad del comando debe comprobarse; bloquear un caso ambiguo es preferible a instalar una segunda copia y anunciar un éxito falso. El coste es una instrucción de migración explícita.
3. **Se elimina `npx` como dependencia operativa, no como capacidad externa del paquete.** Así se simplifica el recorrido sin añadir detección punitiva o frágil de quién ejecutó el binario.
4. **El runtime proyectado permanece.** Los agentes y adaptadores ya lo usan; hacer que funcione como paquete completo ampliaría innecesariamente el cambio. El coste es mantener clara la diferencia en errores y documentación.
5. **La migración es explícita y conservadora.** Primero instalar npm global, verificar `kyro`, luego sincronizar desde un proyecto existente; evita modificar scopes para arreglar distribución.

## Constraints and tradeoffs

- El paquete exige Node >=18. Una instalación global depende del prefijo de npm y del gestor de Node activo; cambiar de versión de Node o de `PATH` puede cambiar el `kyro` visible. Las guías deben incluir comprobación de ruta/versión y solución para errores de permisos mediante un prefijo propio, sin sugerir `sudo` como única salida.
- `~/.agents/kyro/current` es una copia compartida por los proyectos de la máquina. La sincronización desde un proyecto actualiza la copia global; la inicialización de estado sigue ocurriendo desde la raíz del proyecto correcto.
- El plugin de Claude Code es otro canal de distribución. Sus instrucciones de plugin no deben quedar subordinadas a instalar el CLI si el usuario no lo necesita.
- La actualización usa un proceso hijo porque el proceso en ejecución puede ser viejo; la verificación debe tratar por separado el paquete recién instalado, el runtime y el comando visible en una terminal nueva.

## Risks, failure modes and degradation

| Riesgo / disparador | Impacto | Prevención o contención | Señal observable |
| --- | --- | --- | --- |
| `kyro` de pnpm o de otro prefijo encabeza `PATH` | npm actualiza otra copia | Resolver procedencia antes de instalar y bloquear ambigüedad | Ruta activa distinta de la instalación npm gestionada |
| npm instala bien, pero falla `sync` | Paquete nuevo y runtime viejo | Ejecutar desde CLI nuevo; reportar éxito parcial y remedio verificable | Versiones paquete/runtime divergentes |
| Registro caído | No se conoce `latest` | Mensaje explícito y fallo de red controlado; nunca cambiar a `npx` | `--check` indica versión no confirmada |
| Usuario solo tiene runtime proyectado | No existe `kyro` global | Guía de migración de una vez, sin tocar scopes | Ausencia de binario global comprobado |
| Docs o skills mantienen recetas de `npx` | Agentes vuelven al flujo viejo | Inventario de instrucciones activas y prueba de contrato de mensajes | Búsqueda/test detecta receta activa obsoleta |
| Windows invoca `.cmd` como hijo directo | Fallo de ejecución | Mantener ruta `node <runtime>/dist/cli.js` en agentes | Pruebas Windows de invocación/actualización |

## Execution blueprint

1. **Contrato y matriz de entornos.** Revisar `update.ts`, `invocation.ts`, modos de paquete, instalador y pruebas. Definir cómo reconocer binario npm activo, versión objetivo y estados `npm`, `pnpm/otro`, ausente y ambiguo. Entregable: decisiones de comportamiento y pruebas que fallen con la mezcla actual. Puerta: ningún caso ambiguo produce un plan `npm install -g` como si actualizara el comando activo.
2. **Actualizador y migración.** Implementar el plan global npm, retirar la rama `npx`, verificar paquete/`PATH` después de instalar y sincronizar desde CLI nuevo. Mantener `--check`, `--dry-run`, confirmación y errores parciales. Entregable: `kyro update` sin ejecución interna de `npx`. Puerta: escenarios simulados de versión nueva, runtime viejo, sin global, otro gestor, otro prefijo, red fallida y fallo de sincronización.
3. **Entrada e instrucciones vigentes.** Cambiar README, guías, ayuda CLI, diagnósticos, skills, adaptadores y plantillas operativas a instalación npm global y migración. Preservar plugin-only y notas históricas. Entregable: un solo recorrido actual. Puerta: inventario de recetas activas sin `npx` y revisión de rutas Windows.
4. **Validación de distribución.** Ejecutar build, check, pruebas dirigidas de actualización/invocación, `npm pack --dry-run` y la matriz CI aplicable en POSIX y Windows. En un entorno aislado verificar instalación global, `kyro --version`, `install`, `update --check`/`--dry-run`, `update` y runtime. Entregable: evidencia reproducible de que paquete, comando visible y runtime coinciden. Puerta: no se declara listo si alguna versión o ruta diverge.

## Acceptance and validation matrix

| Resultado / invariante | Escenario | Evidencia requerida | Método |
| --- | --- | --- | --- |
| Instalación oficial durable | Máquina limpia con npm global | `kyro` en `PATH`, versión correcta y runtime funcional | Prueba aislada de instalación y doctor |
| Actualización real, sin éxito falso | Versión anterior -> versión objetivo | Paquete instalado, comando visible y runtime con versión objetivo | Prueba de integración con prefijo controlado |
| No mezcla de gestores | Shim pnpm u otro prefijo primero en `PATH` | Plan bloqueado y remedio concreto; sin instalación npm oculta | Pruebas de procedencia y `--dry-run` |
| Migración conserva proyecto | Runtime proyectado sin paquete global | Instalación global + sync; estado/scopes iguales antes y después | Fixture de proyecto y comparación de estado |
| Vista previa pura | `--check` y `--dry-run`, con o sin red | Cero instalaciones, cero escritura, mensaje veraz | Stubs del gestor y diff de archivos |
| Fallo parcial explícito | npm instala, sync falla | Error que distingue pasos y ofrece CLI nuevo verificado | Prueba de fallo inducido |
| Compatibilidad Windows | Shim `.cmd`, CLI global, agente proyectado | Invocación persistida ejecutable y update sin fallo de spawn | CI Windows |
| Recorrido documentado único | README, guías, diagnósticos, skills activos | Comandos npm global/`kyro`; sin receta operativa con `npx` | Revisión dirigida + test de contrato |
| Paquete distribuible | Tarball publicado | Binarios y recursos completos, metadata consistente | `npm pack --dry-run`, build y check |

## Forge handoff

**Objetivo propuesto del scope:** migrar instalación y actualización del CLI de Kyro a npm global como recorrido oficial, sin dependencia interna de `npx`, con detección de procedencia y verificación de versión de extremo a extremo.

**Requisitos candidatos:** instalación global documentada; migración conservadora; actualizador npm único con bloqueo de gestores/prefijos ajenos; postcondición de versión para paquete, binario y runtime; vistas previas puras; errores de fallo parcial; mensajes/skills actualizados; compatibilidad Windows y plugin-only; pruebas e inventario de referencias activas.

**No objetivos:** soporte pnpm global en esta entrega, prohibición de invocaciones externas `npx`, cambios en sprint/scopes y edición de historia.

**Dependencias y orden:** definir procedencia y pruebas de fallo antes de refactorizar `update`; sincronizar mensajes solo cuando el nuevo contrato sea estable; validar tarball y plataformas antes de cerrar. La futura vía pnpm deberá reconocer su propio gestor y verificar el binario visible, sin reutilizar la rama npm.

## Quality gate

Autoevaluación previa a persistencia: tesis/causalidad 15/15; evidencia 14/15; claridad 14/15; resultados observables 15/15; invariantes/fallos 10/10; decisiones/compensaciones 10/10; coherencia de alcance 10/10; handoff ejecutable 10/10. Total 98/100. Fuentes revisadas: conversación, `package.json`, `src/cli/commands/update.ts`, `src/cli/invocation.ts`, `src/cli/package-root-mode.ts`, `scripts/check-update.mjs`, `docs/getting-started.md`, README y documentación oficial npm/pnpm citada arriba. No queda contradicción material: npm es la vía oficial inicial y pnpm se difiere explícitamente.
