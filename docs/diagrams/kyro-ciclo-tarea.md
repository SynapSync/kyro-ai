# Kyro — Microciclo de una tarea

Diagrama `workflow` v2 en español del ciclo por tarea: `context-pack` → implementación → pruebas focalizadas → `record-evidence` → revisión → PASS/FAIL y retorno obligatorio a implementación.

## Fuentes de producto

- `internal/skills/sprint-forge/assets/modes/execute-task.md`: el pack de tarea se obtiene con `context-pack --task`; la implementación valida criterios en el área tocada y registra la evidencia con `record-evidence`.
- `internal/skills/sprint-forge/assets/modes/review-task.md`: la revisión comprueba archivos y criterios, ejecuta checks focalizados y registra `review --verdict pass` o `review --verdict fail`; ningún trabajo queda completo sin evidencia y veredicto PASS.
- `src/cli/routing.ts`: `execute_task` y `review_task` son valores de ruta que cargan sus modos, no comandos CLI de ejecución.

## Alcance

El retorno FAIL representa tanto fallos de pruebas como un veredicto `review --verdict fail`. No modifica estado Kyro ni representa fases de sprint ajenas a una tarea.
