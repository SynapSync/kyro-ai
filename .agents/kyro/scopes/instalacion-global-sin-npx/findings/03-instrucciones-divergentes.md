# Las instrucciones vigentes devuelven a npx

**Severidad:** media.

**Resumen:** README, guías, mensajes CLI, skills y adaptadores aún recomiendan `npx` para instalar o reparar Kyro. Algunos tests afirman esas recetas.

**Archivos afectados:** `README.md`, `docs/getting-started.md`, `docs/cli.md`, `agents/orchestrator.md`, `internal/skills/`, `src/cli/commands/doctor.ts`, tests de contrato.

**Comportamiento visible:** tras cambiar el instalador, un usuario o agente puede seguir instrucciones obsoletas y volver a una ejecución temporal.

**Recomendación:** revisar superficies operativas, actualizar pruebas de texto y preservar referencias históricas y la vía exclusiva de plugin.

**Validación:** inventario dirigido de recetas activas, pruebas de contrato, build/check y paquete seco.
