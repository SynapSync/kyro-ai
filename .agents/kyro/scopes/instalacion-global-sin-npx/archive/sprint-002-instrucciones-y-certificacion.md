---
title: 'instalacion-global-sin-npx — Sprint 2: Instrucciones y certificación de distribución'
date: '2026-09-23'
scope: 'instalacion-global-sin-npx'
sprint: 2
slug: 'instrucciones-y-certificacion'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 2: Instrucciones y certificación de distribución

> Closed: 2026-09-23
> Outcome: shipped

## Objective

Alinear instrucciones, ayuda y diagnósticos con npm global, preservar la vía exclusiva de plugin y certificar el paquete distribuido en POSIX y Windows.

## Definition of Done

- S9 y S10 tienen tareas implementadas, evidencia concreta y veredictos aprobatorios; S8 se verifica en Windows real.
- README, guías, ayuda, diagnósticos y skills activos indican el recorrido npm global y conservan la vía exclusiva de plugin.
- El tarball supera instalación global aislada, build, check, pruebas de adapters, npm pack --dry-run y CI POSIX/Windows.
- La QA independiente revisa todos los requisitos y notas del Sprint 1 antes de cerrar el sprint.

## Phases

### P1 — Recorrido público de instalación y migración

> Dar una receta global coherente en las instrucciones vigentes y conservar la instalación exclusiva de plugin.

#### T2.1: Actualizar README y guías operativas

**Status**: done

**Description**: Revisar README y guías activas de instalación, sincronización, actualización y migración. Presentar npm install -g kyro-ai, kyro install desde la raíz del proyecto, kyro update y el remedio manual coherente. Diferenciar explícitamente la vía exclusiva de plugin Claude, que no exige CLI, y conservar referencias históricas como historia.

**Evidence**:
- Summary: Updated current README and operational guides for npm global CLI installation, project-root initialization, verified update and projected-runtime migration; preserved independent Claude plugin path and historical npx explanation.
- Validation: npm run check:links: PASS, 88 relative-link files checked
- Validation: git diff --check: PASS
- Validation: Targeted active-guide npx search: only historical migration and ephemeral-path explanation remain
- Files changed: `README.md`, `docs/getting-started.md`, `docs/cli.md`, `docs/teams.md`, `docs/agent-adapters.md`, `docs/HOW-TO-USE-CODEX.md`, `docs/HOW-TO-USE-OPENCODE.md`

**Verdict**: pass

---
### P2 — Ayuda, diagnósticos y agentes

> Eliminar remedios operativos obsoletos en código y plantillas que reciben usuarios y agentes.

#### T2.2: Alinear ayuda y remedios del CLI

**Status**: done

**Description**: Actualizar mensajes de ayuda y diagnósticos activos que recomiendan npx en doctor, estado de proyecto, conciliación, plan, reglas y guardas de paquete. Mantener errores distintos para paquete completo, runtime proyectado, migración y estado incompleto; ajustar pruebas de contrato que afirman las recetas antiguas.

**Evidence**:
- Summary: Replaced active CLI package-root, doctor, project-state, reconciliation, plan, rule, and artifact remedies with npm-global installation and project-root install/sync steps; retained projected-runtime package boundary and updated text contracts.
- Validation: npm run build: PASS
- Validation: npm run check:cli-bundle: PASS, projected/corrupt roots blocked and global migration fixture
- Validation: npm run check:scope-registry-reading: PASS
- Validation: npm run check:plan: PASS
- Validation: npm run check:rule: PASS
- Files changed: `src/cli/commands/doctor.ts`, `src/cli/commands/artifact-doctor.ts`, `src/cli/commands/plan.ts`, `src/cli/commands/rule.ts`, `src/cli/state.ts`, `src/cli/project/reconcile.ts`, `src/cli/package-root-mode.ts`, `scripts/check-cli-bundle.mjs`, `scripts/check-scope-registry-reading.mjs`

**Verdict**: pass

---
#### T2.3: Alinear skills, routers y plantillas de agentes

**Status**: done

**Description**: Revisar instrucciones activas de orchestrator, skills canónicos y texto generado de command skills para que arranque, recuperación y falta de capacidades remitan al paquete npm global. Conservar la resolución de invocación ejecutable en Windows y la vía de plugin sin instalación CLI obligatoria. Adaptar pruebas de startup, rutas y assets proyectados.

**Evidence**:
- Summary: Agent startup now resolves a bundled full-package CLI through CLAUDE_PLUGIN_ROOT for plugin-only Claude use; npm global recovery remains for missing CLI, and projected runtime is never used for install/sync.
- Validation: npm run check:startup-contract: PASS, 10 elements in both entry points including plugin fallback
- Validation: npm run check:no-placeholder: PASS
- Validation: npm run check:token-budgets: PASS
- Validation: npm run check:adapters: PASS
- Files changed: `agents/orchestrator.md`, `internal/skills/sprint-forge/SKILL.md`, `internal/skills/qa-review/SKILL.md`, `internal/skills/kyro-sprint-executor/SKILL.md`, `scripts/check-startup-contract.mjs`

**Verdict**: pass

---
### P3 — Certificación del paquete y plataformas

> Probar el tarball instalado como usuario final y ejecutar la ruta crítica en un runner Windows real.

#### T2.4: Probar instalación global desde tarball y migración

**Status**: done

**Description**: Extender fixtures para crear el tarball, instalarlo en un prefijo npm temporal limpio, abrir una invocación nueva por PATH y ejecutar kyro install/update o sync según corresponda. Verificar CLI y recursos empaquetados, versión de paquete/comando/runtime y preservación de scopes en migración. Añadir comprobaciones de npm pack y cobertura de recursos distributivos.

**Evidence**:
- Summary: Corregido el fixture del tarball: PATH inicial contiene Node pero no kyro; token audit corre antes de migrar; tras npm global sync los diagnósticos usan el PATH migrado. El tarball y la migración conservaron estado/scopes.
- Validation: npm run check:cli-bundle PASS en checkout original 5.0.0 y rama temporal 4.51.0 con PATH aislado
- Validation: npm run check PASS en rama temporal con HOME y PATH limpios, sin kyro global; /tmp/kyro-sprint2-ci-clean-check.log
- Validation: npm pack --dry-run --json PASS: kyro-ai 4.51.0, 976 files
- Validation: GitHub Actions 35815753272 SHA 8e90068: Ubuntu Validate step SUCCESS; release-version gate FAILURE porque v4.51.0 ya publicada
- Files changed: `scripts/check-cli-bundle.mjs`
- Notes: CI global permanece rojo únicamente por gate de publicación de la PR draft temporal, que conserva versión base 4.51.0; no se modificó gate ni se certifica publicación. Windows Node 18/20/22 SUCCESS en el mismo SHA.

**Verdict**: pass

---
#### T2.5: Ejecutar smoke de npm global en Windows CI

**Status**: done

**Description**: Ampliar el smoke Windows y el workflow para instalar el tarball con npm global en un prefijo aislado, ejecutar el shim real en una terminal nueva y probar install, invocación persistida, sync/update y sus postcondiciones relevantes. Registrar evidencia del runner Windows real; si falla, corregir la causa antes de certificar.

**Evidence**:
- Summary: Smoke npm global desde tarball ejecutado en runners Windows nativos Node 18/20/22 sobre SHA final 8e90068d831d1be8ea9496e25bdedf9e7a1aef01: build, identidad de archivo, contratos invocation/update, instalación y sync global desde tarball, y lock pasaron.
- Validation: Actions run 35815753272 Windows Node 18 SUCCESS https://github.com/SynapSync/kyro-ai/actions/runs/35815753272/job/107036795563
- Validation: Actions run 35815753272 Windows Node 20 SUCCESS https://github.com/SynapSync/kyro-ai/actions/runs/35815753272/job/107036795485
- Validation: Actions run 35815753272 Windows Node 22 SUCCESS https://github.com/SynapSync/kyro-ai/actions/runs/35815753272/job/107036795382
- Validation: Ubuntu Validate step SUCCESS, including build/check/adapters/tokens/artifacts/npm pack; job overall FAILURE only at Verify release version is new because draft PR uses already released v4.51.0 https://github.com/SynapSync/kyro-ai/actions/runs/35815753272/job/107036795202
- Files changed: `scripts/check-windows-install-smoke.mjs`, `.github/workflows/ci.yml`
- Notes: PR #137 es vehículo temporal draft desde develop; su gate de publicación no fue modificado, el run global sigue FAILURE y no certifica una publicación. El smoke Windows y sus postcondiciones sí pasaron en el SHA final. Checkout original conserva código Sprint1/snapshot que esta PR aislada no incluye; no usar esta PR como aprobación de merge de todo el scope.

**Verdict**: pass

---

## Unfinished work

_None — every task is done with a passing verdict._

## Learnings

- La instalación y sincronización deben verificarse desde el tarball distribuido y con el comando realmente visible en PATH.
- La PR temporal #137 dejó evidencia histórica que exigió una corrección append-only E2 antes de certificar la PR final #138.
- La salida de npm global debe permanecer visible y permitir distinguir EACCES/EPERM de errores de red.

## Resolved Debt

_No debt resolved in this sprint._

## Recommendations for Sprint 3

- Revisar E2 junto con los registros históricos T2.2/T2.4/T2.5 al auditar esta entrega.
- Tras el merge a develop, promover 4.52.0 a main y verificar tag, publicación npm y GitHub Release.
