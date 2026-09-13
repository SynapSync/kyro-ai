# Backups temporales residuales tras éxito del pipeline

- **Severidad:** medium
- **Archivos afectados:** `src/cli/pipeline/operation-steps.ts`, `src/cli/pipeline/orchestrator.ts`

Los snapshots de directorio se alojan bajo temporales `kyro-pipeline-*`. La limpieza del backup se realiza al restaurar un directorio durante rollback; no existe una fase de confirmación o disposición en el camino de éxito del orquestador. Como consecuencia, una ejecución exitosa puede dejar backups temporales residuales.

**Recomendación:** retener backups hasta que la transacción completa se confirme y limpiar solamente las rutas registradas por ese plan; mantener evidencia explícita cuando el rollback falle.

**Validación:** planes exitosos y fallidos con comparación del estado de `tmpdir()` antes/después, junto con verificación de rollback por tipo de target.
