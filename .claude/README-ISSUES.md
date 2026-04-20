# README Desactualización — Análisis

## Issues Encontrados

### 1. **Versión (Línea 35)**
- **README dice:** "What's New in v2.0"
- **Realidad:** v3.1.0
- **Impacto:** Confunde a usuarios sobre qué versión están usando
- **Fix:** Actualizar a v3.0+

### 2. **Guardian Events Mismatch (Línea 40, 247-262)**
**README lista 10 eventos:**
- session_start
- pre_tool_use ❌
- post_tool_use ❌
- stop ❌
- session_end
- user_prompt_submit ❌
- pre_compact ❌
- subagent_start ❌
- subagent_stop ❌
- task_completed

**Realidad en `config.json` (10 eventos actuales):**
- session_start ✓
- pre_phase ✓
- post_edit_scan ✓
- pre_commit ✓
- test_failure ✓
- task_complete ✓ (no "task_completed")
- drift_check ✓
- rule_check ✓
- learn_capture ✓
- session_end ✓

**Impacto:** Documentación completamente desincronizada con implementación
**Fix:** Actualizar tabla con eventos reales del config.json actual

### 3. **Documentación Guides Count (Línea 118)**
- **README dice:** "7 documentation guides"
- **Realidad:** 8 guías (falta model-selection.md en la lista)
- **Archivos:** getting-started, commands-reference, agents-reference, rules-guide, architecture, model-selection, context-management (7 en README, pero 8 existen)
- **Fix:** Actualizar a 8

### 4. **Comparación v1.x vs v2.0 (Línea 322-336)**
- **Problema:** La tabla compara v1.x vs v2.0, pero el proyecto está en v3.1.0
- **Impacto:** Confunde sobre la evolución del proyecto
- **Opciones:**
  - A) Remover completamente (si v1.x es antiguo)
  - B) Actualizar a v2.0 vs v3.0+ (si es útil históricamente)
  - C) Reemplazar con timeline de evolución

### 5. **Línea 114: "base skill from v1.x"**
- **Contexto:** El sprint-forge proviene de v1.x, pero la arquitectura ha evolucionado
- **Fix:** Clarificar la herencia sin confundir

### 6. **Installation Methods (Línea 156-169)**
- **Problema:** Dice `/plugin marketplace add SynapSync/kyro-workflow` pero no está claro si realmente está en marketplace
- **Risk:** Si no está publicado, estos comandos fallarán
- **Fix:** Verificar si está publicado en marketplace

---

## Estrategia de Actualización

### Prioridad Alta:
1. ✅ Guardian Events table — crítico, está completamente equivocado
2. ✅ Versión (v2.0 → v3.0+)
3. ✅ Docs count (7 → 8)

### Prioridad Media:
4. ⚠️ v1.x vs v2.0 comparison — considerar contexto de historia

### Verificar:
- ¿Está el plugin realmente publicado en marketplace?
- ¿Están todos los comandos actualizados?
