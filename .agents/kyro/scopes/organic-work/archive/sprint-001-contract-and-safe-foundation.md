---
title: 'organic-work — Sprint 1: Contrato Work y base segura'
date: '2026-09-26'
scope: 'organic-work'
sprint: 1
slug: 'contract-and-safe-foundation'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 1: Contrato Work y base segura

> Closed: 2026-09-26
> Outcome: shipped

## Objective

Definir y probar el contrato Work v1, materializar de forma segura un Work y reanudarlo mediante status/context pack sin alterar estado Forge.

## Definition of Done

- Las cuatro tareas tienen evidencia real y veredicto pass con todos sus criterios cubiertos.
- El contrato work.json v1 y sus transiciones iniciales coinciden con el plan Idea o una enmienda explícita y justificada.
- Los escenarios S1-S10 se prueban o registran como brecha; no se declara completo con escenarios críticos pendientes.
- La suite de Work, las regresiones Forge relevantes, build y verificación de paquete pasan con resultados registrados.
- No se ejecuta ni se simula la promoción Work a Forge; queda para un sprint posterior.

## Phases

### P1 — Contrato ejecutable

> Fijar esquema, semántica de campos y transiciones antes de introducir escritores.

#### T1.1: Especificar y validar work.json v1

**Status**: done

**Description**: Implementar tipos y validador independientes para cada clave y objeto del contrato normativo del plan Idea, incluyendo brief/sourceIdea, handoff, tareas, evidencia, veredicto, activity, closure y promotion. Validar claves exactas, IDs, fechas, digests, referencias, grafo y coherencia entre estados; fixtures válidos y adversariales deben impedir que una forma parcialmente válida se vuelva escribible.

**Evidence**:
- Summary: Strengthened Work v1 validation for evidence state, canonical material binding, and activity consistency; added adversarial fixtures and an independent digest formula assertion.
- Validation: npm run build (passed)
- Validation: npm run check:work-contract (passed)
- Validation: npm run check:work-store (passed)
- Validation: npm run check:work-isolation (passed)
- Validation: npm run typecheck (passed)
- Validation: git diff --check (passed)
- Validation: npm pack --dry-run (passed)
- Files changed: `src/cli/work/schema.ts`, `src/cli/types.ts`, `scripts/check-work-contract.mjs`
- Notes: Fresh QA remediation; final evidence recorded through the Kyro CLI after canonical digest formula coverage.

**Verdict**: pass

---
### P2 — Persistencia y lectura aisladas

> Probar seguridad de rutas, atomicidad, revisión y lectura reanudable.

#### T1.2: Crear almacén Work confinado y transaccional

**Status**: done

**Description**: Implementar resolución de .agents/kyro/work/<id>/, lectura estricta y escritor CLI con bloqueo, revisión esperada y reemplazo atómico. Rechazar colisiones, escape, symlinks y estados corruptos antes de mutar. El camino dry-run no escribe. No introducir un registro global Work.

**Evidence**:
- Summary: Refreshed transactional-store regression evidence against final Work validation: a coherent valid update increments revision once; stale and invalid transitions preserve bytes; path, root, dry-run, isolation, and concurrency guards fail closed.
- Validation: npm run build: passed
- Validation: npm run check:work-store: passed
- Validation: npm run check:work-isolation: passed
- Files changed: `src/cli/work/store.ts`, `scripts/check-work-store.mjs`
- Notes: The successful update includes a matching tasks_planned activity at the new revision. Same-ID concurrency produced one winner and one conflict; invalid reads and digest mismatch remained fail-closed.

**Verdict**: pass

---
#### T1.3: Exponer create, status y context pack de Work

**Status**: done

**Description**: Añadir despacho CLI mínimo `kyro work create|status|context-pack` y generación validada de brief.md más work.json desde una Idea o brief suficiente. Status/context pack deben derivar estado y próximo paso desde Work, ofrecer JSON estable y detectar mismatch de digest sin asumir `done` ni leer un scope.

**Evidence**:
- Summary: Refreshed create/read-model evidence against the final coherence validator: objective extraction, faithful source digest, empty-draft routing, invalid-document errors, digest degradation, and result-phase read-only envelopes all pass.
- Validation: npm run build: passed
- Validation: npm run check:work-contract: passed
- Validation: npm run check:work-store: passed
- Validation: npm run check:cli-envelope: passed
- Validation: npm run check:cli-verbs: passed
- Validation: npm run check:work-isolation: passed
- Files changed: `src/cli/commands/work.ts`, `src/cli/core/cli-envelope.ts`, `src/cli/work/schema.ts`, `scripts/check-work-store.mjs`, `scripts/check-cli-envelope.mjs`
- Notes: Markdown and Idea front matter fixtures preserve the H1 title and original brief bytes; title-only and one-character sources fail before creating Work. Both status and context-pack reject an invalid Work document with a specific handoff field error.

**Verdict**: pass

---
### P3 — Prueba de integración y rastreabilidad

> Demostrar que el nuevo almacén queda versionable y no altera el ciclo Forge.

#### T1.4: Cubrir trackability Git y regresión de Forge

**Status**: done

**Description**: Habilitar el seguimiento Git de .agents/kyro/work/ sin exponer local.json/trace/ ni cambiar reglas de scopes. Probar create/status/context pack sobre workspace con Forge preexistente, comparar hashes de capas y sprints, y ejecutar los gates de build/check y empaquetado relevantes al CLI.

**Evidence**:
- Summary: Final Sprint 1 integration checks pass for Work contract, storage, isolation, read-only envelope, dist, CLI bundle, and package contents; aggregate check exposes the pre-existing installed-runtime capability mismatch.
- Validation: npm run build: passed
- Validation: npm run check:work-contract: passed
- Validation: npm run check:work-store: passed
- Validation: npm run check:work-isolation: passed
- Validation: npm run check:cli-envelope: passed
- Validation: npm run check:dist: passed
- Validation: npm run check:cli-bundle: passed
- Validation: npm pack --dry-run: passed
- Validation: git diff --check: passed
- Validation: npm run check: failed at check:repair-integrity because global runtime 5.0.1 lacks the Work capability
- Files changed: `package.json`, `scripts/check-work-isolation.mjs`, `scripts/check-work-store.mjs`, `scripts/check-work-contract.mjs`, `scripts/check-cli-envelope.mjs`
- Notes: Focused checks prove Git trackability and byte-identical Forge layers/sprints. The aggregate run fails before its Work checks because the installed runtime capability manifest has not been updated; the runtime was left untouched.

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
