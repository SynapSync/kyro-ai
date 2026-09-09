# Snapshot recursivo innecesario para operaciones sin efecto

- **Severidad:** medium
- **Archivos afectados:** `src/cli/pipeline/operation-steps.ts`, `src/cli/install-plan.ts`

`OperationStep.run()` toma un snapshot incondicional antes de aplicar cada operación. Si el target existente es un directorio, `snapshotTarget()` crea un temporal `kyro-pipeline-*` y lo copia recursivamente. Para `mkdirSync(target, { recursive: true })` sobre un directorio existente, la operación no muta el contenido, por lo que esa copia es trabajo innecesario. Las instalaciones repetidas incluyen `mkdir` sobre rutas que pueden existir.

**Recomendación:** definir snapshots específicos por operación y omitir el backup para `mkdir` y `rmdir-if-empty` cuando se determine que no mutarán. Conservar snapshots suficientes para los casos que sí pueden requerir rollback.

**Validación:** fixture con `mkdir` sobre directorio existente con contenido que compruebe ausencia de copia recursiva y preservación del directorio.
