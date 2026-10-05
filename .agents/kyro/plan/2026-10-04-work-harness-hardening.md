---
docType: plan
date: 2026-10-04
slug: work-harness-hardening
title: Endurecer el harness de Work sobre Kyro 6.1.0
---

# Endurecer el harness de Work sobre Kyro 6.1.0

## Objetivo y base

Recuperar del respaldo las mejoras verificadas de validación, cobertura y ayuda del CLI, conservando las correcciones actuales de `develop`.

- Rama de implementación: `feature/work-harness-hardening`.
- Base: `develop`, commit `d6894b50b28ae239513fe9757e9d2eca89732186`, sincronizado con `origin/develop` después de `git fetch origin --prune --tags`.
- Fuente de recuperación: `feature/local-backup-2026-10-04`, commit `fdd4a78e943741b5a2e8370934f9f3e1c3a1af86`.
- Integración por cambios puntuales; conservar la versión 6.1.0.

## Cambios seleccionados

1. Añadir al contrato de Work el rechazo de `closure.outcome: completed` cuando no hay tareas. Reportar el error en `closure.outcome`; un cierre vacío con `stopped` seguirá siendo válido. `asWorkFile` debe rechazar el mismo estado inválido.
2. Añadir la receta de cierre de borradores a `context-pack`, con razón, actor, revisión actual y `--dry-run`. Mantener la supresión de recetas de mutación cuando existen anomalías.
3. Conservar las reglas de cierre, mensajes de error y reapertura de 6.1.0. Recuperar la explicación adicional de `work --help`; no trasladar los cambios equivalentes de `store.ts`.
4. Actualizar la guía de Work, la skill `organic-work` y `CHANGELOG.md` bajo `Unreleased` para explicar la validación y la conservación del brief e historial.

No recuperar los planes antiguos, las fechas alternativas de completion ni la eliminación de `organic-work-smoke`.

## Tests y aceptación

Ampliar los checks existentes de contrato y cierre, adaptando los tests del respaldo a los mensajes actuales:

- Un objeto vacío cerrado como `completed` debe fallar en `closure.outcome`; `asWorkFile` debe devolver `null`. El equivalente `stopped` debe validar.
- Comprobar la receta directamente en `data.recipes`, incluyendo revisión y `--dry-run`; después de reabrir, debe usar la nueva revisión.
- Verificar rechazo sin `--yes`, revisión obsoleta, intento de completar un borrador y cierre de Work promovido.
- Verificar que previews y operaciones rechazadas conservan los bytes del Work, brief y artefactos Forge.
- Probar fallos inyectados antes de escribir el cierre y después de publicar el historial de reapertura; el reintento debe conservar la procedencia y reutilizar el registro inmutable.
- Probar dos ciclos de cierre/reapertura, historiales distintos y planificación posterior del borrador.
- Verificar que un brief alterado conserva el bloqueo y no obtiene recetas de mutación.

Primero demostrar el fallo de las dos regresiones nuevas sobre la base. Después ejecutar `npm run build`, los checks de contrato y cierre, y finalmente `npm run check` completo. Registrar resultados y cualquier bloqueo real; los checks parciales no sustituyen la validación completa.

Comandos de validación con la configuración del repositorio:

```sh
OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf npm_config_cache=/tmp/kyro-ai-npm-cache npm_config_script_shell=/bin/zsh npm run build
OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf npm_config_cache=/tmp/kyro-ai-npm-cache npm_config_script_shell=/bin/zsh npm run check:work-contract
OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf npm_config_cache=/tmp/kyro-ai-npm-cache npm_config_script_shell=/bin/zsh npm run check:work-closure
OPENSSL_CONF=/private/tmp/kyro-empty-openssl.cnf npm_config_cache=/tmp/kyro-ai-npm-cache npm_config_script_shell=/bin/zsh npm run check
```

El archivo de configuración OpenSSL utilizado está vacío. Los fixtures se ejecutan en directorios temporales; no se modifica estado administrado real para probar estos casos.

## Compatibilidad y entrega

Mantener la versión 6.1.0, el esquema v1 y el formato del envelope JSON. El único endurecimiento del contrato será rechazar un cierre `completed` sin tareas; no habrá reparación automática de datos históricos.

La entrega será el plan, el diff selectivo y la evidencia de validación en la nueva rama. Publicación, instalación global, push y PR quedan fuera de esta ejecución.

## Evidencia de ejecución

### Regresiones sobre la base

Con las nuevas aserciones y antes de modificar la implementación:

| Comprobación | Resultado observado |
| --- | --- |
| Build de 6.1.0 | PASS |
| `check:work-contract` | FAIL esperado, exit 1: `taskless closure cannot claim completion must report closure.outcome; got []` |
| `check:work-closure` | FAIL esperado, exit 1: `draft context must expose a revision-bound closure preview` |

Estos fallos prueban que las dos regresiones detectan las carencias de la base, antes de aplicar las correcciones.

### Validación después de la implementación

Implementación aplicada en `feature/work-harness-hardening`. Resultado local: cambios seleccionados implementados; validación global sin aprobar por fallos reproducidos también en la base.

| Comprobación | Resultado |
| --- | --- |
| Build después de los cambios | PASS, exit 0 |
| `check:work-contract` | PASS, exit 0, incluyendo `asWorkFile` y reapertura de borradores |
| `check:work-closure` | PASS, exit 0, incluyendo receta exacta, anomalías, fallos inyectados, preservación de bytes y dos ciclos de cierre/reapertura |
| `npm run check` | FAIL, exit 1; se detuvo en `check:work-store` después de 39 pasos aprobados, en 239.9 segundos |
| Ejecución suplementaria de los 37 pasos restantes | 33 PASS, 4 FAIL; no sustituye la aprobación del comando completo |
| Balance de los 77 pasos configurados | 72 PASS, 5 FAIL |
| `git diff --check` | PASS |

### Bloqueos reproducidos en la base

Los cinco checks fallidos también se ejecutaron contra una copia aislada de `develop` (`d6894b5`) compilada desde sus fuentes intactas. Todos reprodujeron el mismo error y exit 1. Los cinco scripts correspondientes permanecen sin cambios en esta implementación.

| Check | Fallo observado tanto en la base como en la rama |
| --- | --- |
| `check:work-store` | `scripts/check-work-store.mjs:163`: `the virtual-file growth probe must run on Linux`; depende de `/proc/version`, ausente en macOS |
| `check:work-promotion` | `scripts/check-work-promotion.mjs:145`: `ERR_FS_EISDIR` al ejecutar `rmSync` sobre el enlace al directorio `staged-target` del fixture |
| `check:work-doctor` | `scripts/check-work-doctor.mjs:80`: `ERR_FS_EISDIR` al ejecutar `rmSync` sobre el enlace al directorio Work del fixture |
| `check:install-rehydrate` | `scripts/check-install-rehydrate.mjs:165`, llamado desde la línea 223: `fixture workspace must be active` |
| `check:update` | `scripts/check-update.mjs:149`: el fixture esperaba diagnosticar un paquete npm incompleto, pero recibió `The active kyro command belongs to another manager or npm prefix; align PATH with the npm global prefix before updating.` |

El entorno de la rama utiliza macOS con Node v25.2.1. Las reproducciones en la copia de la base utilizaron Node v24.11.1 en el mismo host; por tanto no se atribuyen estos fallos exclusivamente a Node v25. Las causas de los dos fallos de instalación/actualización no se consideran diagnosticadas más allá de los errores reproducidos.

Docker está instalado, pero `docker info` no pudo conectar con el daemon. No se arrancaron servicios, instalaron runtimes ni modificaron los checks para eludir las comprobaciones. La validación completa deberá repetirse en un entorno compatible después de resolver los bloqueos heredados.

### Evidencia y alcance final

Logs temporales completos de esta ejecución: `/var/folders/39/zhd12r1d3c1__mcsbv89gc6r0000gn/T/kyro-work-harness-validation-ow2zu3d3/`. Incluyen `build.log`, `check-work-contract.log`, `check-work-closure.log`, `check.log`, los logs suplementarios y `supplemental-summary.json`. Este resumen conserva los resultados aunque se eliminen los logs temporales.

Se comprobó mediante `git diff --exit-code` que siguen intactos `src/cli/work/store.ts`, los scopes y Work existentes, `package.json`, `package-lock.json` y `WORKFLOW.yaml`. La versión sigue siendo 6.1.0; no se recuperaron los planes antiguos ni se borró el Work de prueba. Las reglas y mensajes de `closeWork` y el envelope JSON permanecen sin cambios. No hubo reparación de datos históricos, publicación, instalación global, push ni PR.

SHA-256 de los archivos de implementación y tests validados:

- `src/cli/work/schema.ts`: `1c4a1506093e1426054bdce48326ec4197aa1ceed909cd51957b78d98d256c48`
- `src/cli/commands/work.ts`: `dc123a390c4f804e12679fbb30d41ba0826832d22590eb4cd10e45dc0c0037e1`
- `scripts/check-work-contract.mjs`: `f24622dc3054060bf9758094b5185453ac0d1d7ca4381ead98d5c7b9b447fadf`
- `scripts/check-work-closure.mjs`: `1baa9a3147370711223fd01a660346a6d8c20d881b0369a3015354b992eb47ed`


## Preparación de release 6.1.1

La solicitud posterior del usuario autoriza el cambio de versión, el commit, el push a `develop` y un PR de `develop` hacia `main`. Sustituye para esta fase la exclusión anterior de push y PR; no autoriza fusionar el PR ni publicar manualmente.

El candidato utiliza 6.1.1: se verificó npm `latest=6.1.0`, ausencia de `kyro-ai@6.1.1` en npm y ausencia de `v6.1.1` entre los tags remotos actualizados. `main` y `develop` tienen contenido idéntico antes de estos cambios. Se sincronizan `package.json`, los dos campos raíz de `package-lock.json`, `WORKFLOW.yaml` y la sección del changelog para 2026-10-04.

Los cinco fallos locales anteriores permanecen como evidencia histórica. El PR ejecutará la suite completa en Ubuntu con Node 20 y los checks de instalación y escritura en Windows con Node 18, 20 y 22. El workflow crea tag, publica npm y crea GitHub Release solamente después de un push a `main` y sus gates satisfactorios. Abrir el PR no constituye publicación.

Validación local del candidato 6.1.1: build, sincronización de versiones, contrato y cierre de Work, frescura de dist, adapters y links terminaron con exit 0. Los comandos `check:tokens` y `check:artifacts` también terminaron con exit 0; el doctor conserva avisos del entorno instalado y presupuestos existentes, que no se presentan como un resultado libre de avisos.

`npm pack --dry-run --json` produjo el candidato `kyro-ai-6.1.1.tgz` con 1019 entradas, 9830551 bytes empaquetados y 21522958 bytes sin comprimir. Se comprobó que no incluye `.claude-plugin/`, `providers/claude/`, `hooks/` ni `.agents/`. No se publicó el paquete.

Logs locales del candidato: `/var/folders/39/zhd12r1d3c1__mcsbv89gc6r0000gn/T/kyro-6-1-1-release-5buflr9q/`. La aprobación del release queda pendiente de los gates del PR en Ubuntu y Windows; los resultados locales parciales no sustituyen esa validación completa.


### Primera validación remota del release

PR de release: https://github.com/SynapSync/kyro-ai/pull/149, `develop` hacia `main`. El commit inicial del candidato fue `743b5dbc706775e0ddf13493f16edfa7349a428c`.

El run https://github.com/SynapSync/kyro-ai/actions/runs/37260957295 aprobó los tres jobs de Windows (Node 18, 20 y 22). Ubuntu falló en `check:remediation-release-docs`: exigía mencionar la versión candidata 6.1.1 en `README.md` y `docs/cli.md`. Este fue un defecto de preparación del release, distinto de los fallos anteriores del entorno macOS.

Se corrige la referencia al candidato actual en README y se añade una fila 6.1.1 en la matriz de CLI, preservando la fila histórica 6.1.0 y sus capacidades originales. Se valida el contrato de documentación antes de subir la corrección al mismo PR; la validación completa remota deberá repetirse sobre el nuevo commit.

Validación local de la corrección de documentación: `check:remediation-release-docs` aprobó sus 86 aserciones, `check:links` aprobó los 91 archivos comprobados y `git diff --check` terminó correctamente.
