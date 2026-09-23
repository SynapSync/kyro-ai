# Rama npx y usuarios con runtime proyectado

**Severidad:** media.

**Resumen:** `src/cli/commands/update.ts` ejecuta `npx` cuando no ve un binario durable. `src/cli/package-root-mode.ts` impide que el runtime proyectado haga `install` o `sync`.

**Archivos afectados:** `src/cli/commands/update.ts`, `src/cli/package-root-mode.ts`, `scripts/check-update.mjs`.

**Comportamiento visible:** usuarios existentes pueden tener un runtime Kyro, pero no un comando global; la actualización actual perpetúa esa situación.

**Recomendación:** retirar la ejecución interna de `npx`, ofrecer migración explícita a npm global y conservar el bloqueo del runtime proyectado como fuente de instalación.

**Validación:** fixture de usuario sin global, vista previa pura, guía de migración y comparación del estado del proyecto antes y después.
