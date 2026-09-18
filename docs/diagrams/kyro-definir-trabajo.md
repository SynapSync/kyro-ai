# Kyro — etapa 1: definir el trabajo

Desglose del primer tramo del [ciclo de vida](kyro-lifecycle.html): pedido → INIT → estado materializado → planear sprint.

HTML: [kyro-definir-trabajo.html](kyro-definir-trabajo.html)

## Qué cubre

1. Pedido del usuario (idea suelta o scope ya nombrado).
2. Idea madura opcional; si existe, INIT la consume sin re-entrevistar.
3. Clasificar tipo de trabajo y escribir findings.
4. Sizear el roadmap.
5. `kyro plan --from` escribe `sprint.json` / `project.json` / `local.json`.
6. Si hay unknowns de diseño → `clarify` (una pregunta, CLI registra).
7. Si no → `plan_sprint` (siguiente etapa).

## Límites

No incluye planear tareas del sprint activo, ejecutar, QA ni cierre. No dibuja el handshake de capabilities ni fallos de runtime.

## Evidencia

- `internal/skills/sprint-forge/assets/modes/INIT.md`
- `internal/skills/sprint-forge/assets/modes/clarify.md`
- `internal/skills/sprint-forge/assets/modes/plan-sprint.md` (solo como salida)

Validación Archify showcase: 9/9. Recibo: `kyro-definir-trabajo.delivery.json`. Browser check: PASS. Inspección visual de la captura 2048×1320 clara; no es revisión de todas las variantes.
