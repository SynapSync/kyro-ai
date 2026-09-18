# Kyro — punto 1: planear el siguiente sprint

Diagrama del modo `plan_sprint`: desde la ruta de planificación hasta el `handoff` que habilita la primera tarea del sprint. No representa INIT, ejecución, revisión, QA ni cierre.

HTML: [kyro-planear-sprint.html](kyro-planear-sprint.html)

## Flujo representado

1. El orquestador llega a `plan_sprint` y abre la fuente de verdad: `.agents/kyro/scopes/{scope}/sprint.json`.
2. Obtiene roadmap, `ledger[]`, deuda y convenciones; resuelve el Sprint N y, desde el segundo sprint, exige que N−1 esté cerrado.
3. Revisa `project.json.principles[]`, incorpora recomendaciones previas y deuda debida, y prepara fases/tareas con su trazabilidad a escenarios cuando corresponda.
4. Un detalle de diseño desconocido lleva a `clarify`: no se generan ni finalizan tareas con marcadores `[NEEDS CLARIFICATION]`.
5. Tras generar el objeto `activeSprint`, el agente entrega únicamente un archivo lean temporal a `kyro plan --from <archivo> --kyro-scope <scope>`.
6. El CLI es el único escritor del estado gestionado: activa el roadmap, actualiza la deuda y deja `handoff.nextAction: "execute_task"` para la primera tarea.

## Límites de seguridad y estado

- No se edita directamente `sprint.json`, archivos de fases, `state.json` ni índices.
- La deuda no se elimina ni se reinicia; los elementos debidos pasan a `in_progress`.
- El título de `activeSprint` se copia literalmente del roadmap, y las recomendaciones anteriores tienen una disposición explícita.

## Fuentes

- `internal/skills/sprint-forge/assets/modes/plan-sprint.md`
- `internal/skills/sprint-forge/assets/helpers/sprint-generator.md`
- `agents/orchestrator.md`
- `commands/forge.md`

## Evidencia de entrega

- Especificación: `kyro-planear-sprint.workflow.json` (workflow v2, español, `showcase`).
- Validación Archify: 9/9, 0 errores, 0 advertencias. Recibo: `kyro-planear-sprint.delivery.json`.
- Browser check: PASS; contiene captura light/dark a 1440×900 y 2048×1320, además de comprobación de contención a 1600×1000 y 1920×1080.
- Revisión visual: aprobada manualmente sobre las capturas 2048×1320 en ambos temas; rutas, etiquetas, nodos y tarjetas son legibles y no presentan cruces u overflow visibles.
