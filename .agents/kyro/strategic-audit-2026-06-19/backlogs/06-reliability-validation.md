# Backlog: Reliability and Validation System

Kyro already validates artifact shapes in TypeScript, but agents and fixtures need reusable contracts. Reliability improves when artifact validity is not dependent on reading TypeScript code or following prose.

## Evidence

- `src/cli/artifacts/schema.ts` validates project state, scope state, index, roadmap summary, sprint summary, and debt summary.
- Templates for summaries exist under `skills/sprint-forge/assets/templates/`.
- Artifact fixtures cover valid, missing-summary, invalid-state, active-sprint-missing, and stale-summary cases.

## Technical correction

Export schemas, validate templates and generated artifacts against them, and run validation at every relevant lifecycle boundary.

## Tasks

| ID | Priority | Size | Task | Likely files | Acceptance criteria | Validation |
|----|----------|------|------|--------------|---------------------|------------|
| REL-001 | P1 | M | Export JSON Schemas for artifact types | `src/cli/artifacts/schemas/*.json`, `src/cli/artifacts/schema.ts` | Schemas exist for project state, scope state, index, roadmap summary, sprint summary, debt summary | Schema fixture tests |
| REL-002 | P1 | M | Validate templates against schemas | `scripts/check-artifact-template-schemas.mjs`, templates | Template JSON examples conform after placeholder substitution or fixture generation | `npm run check:artifact-templates` |
| REL-003 | P1 | M | Refactor artifact validator to use shared schema definitions | `src/cli/artifacts/schema.ts` | Runtime validation and exported schemas cannot drift | Unit/fixture tests |
| REL-004 | P1 | M | Add validation command for changed artifacts | `src/cli/commands/artifact-validate.ts` | Can validate only a scope or all scopes | `kyro artifact validate --kyro-scope demo` fixture |
| REL-005 | P1 | S | Add validation gates to docs/routers | `commands/*.md`, `skills/sprint-forge/assets/modes/*.md` | Routers name deterministic validation command after artifact changes | Link/token checks |
| REL-006 | P2 | M | Add diff boundary check | script/CLI | Detects changed files outside planned task scope and reports warning/fail depending mode | Fixture with allowed/disallowed paths |

## Validation stages

| Stage | Required check |
|-------|----------------|
| Before task | state/index/schema validity |
| During task | planned files vs changed files |
| After task | summaries refreshed and validated |
| Before commit | dist, adapters, schemas, docs, links |
| Before PR | full package dry-run and fixture suite |
