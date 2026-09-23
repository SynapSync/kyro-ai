# Actualizador confunde binario duradero con instalación npm

**Severidad:** alta.

**Resumen:** `src/cli/commands/update.ts` elige npm global cuando `src/cli/invocation.ts` encuentra cualquier `kyro` durable, y luego busca el paquete nuevo con `npm root -g`. Un shim de pnpm u otro prefijo puede seguir primero en `PATH`.

**Archivos afectados:** `src/cli/commands/update.ts`, `src/cli/invocation.ts`, `scripts/check-update.mjs`.

**Comportamiento visible:** `kyro update` puede anunciar éxito mientras el `kyro` que usará la próxima terminal conserva otra versión.

**Recomendación:** clasificar la procedencia del comando antes de instalar, bloquear gestores/prefijos ajenos y verificar después paquete, comando visible y runtime antes de declarar éxito.

**Validación:** pruebas de rutas npm, pnpm, prefijos competidores y fallo parcial; integración con prefijo global aislado.
