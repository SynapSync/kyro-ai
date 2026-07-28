# Overview práctico: scope → sprint → task → execute → review (con delegación)

Flujo real de Kyro. **Un solo agente (orchestrator)** coordina siempre. Los **delegates** son opt-in y solo cubren **una task** a la vez. El **CLI** es el dueño de `sprint.json`.

---

## 1. Mapa de alto nivel (ciclo de vida)

```mermaid
flowchart TB
  subgraph USER["Tú"]
    U["/kyro:forge<br/>scope + objetivo"]
  end

  subgraph ORCH["Orchestrator"]
    R["context-pack --json<br/>lee handoff.nextAction"]
    R --> ROUTE{nextAction?}
  end

  U --> R

  ROUTE -->|sin sprint.json| INIT["INIT<br/>análisis + scope"]
  ROUTE -->|clarify| CLAR["clarify<br/>preguntas de negocio"]
  ROUTE -->|plan_sprint| PLAN["plan_sprint<br/>sprint + tasks"]
  ROUTE -->|execute_task| EXEC["execute_task<br/>implementar task"]
  ROUTE -->|review_task| REV["review_task<br/>veredicto"]
  ROUTE -->|close_sprint| CLOSE["close_sprint<br/>checkpoint + ledger"]
  ROUTE -->|done| DONE["Scope completo"]

  INIT --> PLAN
  CLAR --> PLAN
  PLAN --> EXEC
  EXEC --> REV
  REV -->|pass + más tasks| EXEC
  REV -->|fail| EXEC
  REV -->|sprint completo| CLOSE
  CLOSE -->|más sprints| PLAN
  CLOSE -->|roadmap done| DONE

  subgraph SOT["Source of Truth"]
    SJ[".agents/kyro/scopes/{scope}/sprint.json"]
  end

  PLAN -.->|escribe plan| SJ
  EXEC -.->|record-evidence| SJ
  REV -.->|kyro review| SJ
  CLOSE -.->|close-sprint| SJ
```

**Regla de oro:** el orchestrator **rutea** con `context-pack`; **no** abre el `sprint.json` completo solo para decidir qué hacer.

---

## 2. De la idea al plan (scope + sprint + tasks)

```mermaid
sequenceDiagram
  actor You as Tú
  participant Forge as /kyro:forge
  participant Orch as Orchestrator
  participant CLI as Kyro CLI
  participant SJ as sprint.json

  You->>Forge: "Scope oauth-login: login con Google"
  Forge->>Orch: load SKILL + mode según nextAction

  Note over Orch,SJ: INIT (primera vez)
  Orch->>CLI: context-pack --kyro-scope oauth-login
  CLI-->>Orch: sin sprint → nextAction=init
  Orch->>Orch: INIT + analysis helper
  Orch->>SJ: crea scope + successCriteria / principles
  Orch->>SJ: handoff.nextAction = plan_sprint<br/>(o clarify si faltan decisiones)

  Note over Orch,SJ: PLAN
  Orch->>Orch: plan-sprint + sprint-generator
  Orch->>SJ: activeSprint + phases + tasks<br/>T1.1, T1.2, …
  Orch->>SJ: handoff.nextAction = execute_task<br/>handoff.nextTaskId = T1.1

  Note over You,Orch: Gate humano si aplica<br/>(aprobar plan / sprint)
```

**Qué queda en el plan de una task típica:**

| Campo | Uso después |
|-------|-------------|
| `id` (ej. `T1.1`) | Unidad de handoff y de delegación |
| `description` / acceptance | Brief del implementer y del checker |
| `files_to_touch` | Scope de cambios y review |
| `depends_on` | Orden de ejecución |

---

## 3. Ejecución + revisión de **una** task (default: single-agent)

Sin `delegationEnabled` y sin “usa delegate”:

```mermaid
flowchart LR
  subgraph EXEC["execute_task"]
    A1["context-pack --task → task pack"]
    A2["Orchestrator implementa<br/>código + validación scoped"]
    A3["CLI: record-evidence T1.1"]
    A1 --> A2 --> A3
  end

  subgraph REV["review_task"]
    B1["context-pack --task T1.1"]
    B2["Orchestrator revisa<br/>+ helper reviewer.md"]
    B3["CLI: review T1.1<br/>--verdict pass|fail"]
    B1 --> B2 --> B3
  end

  A3 -->|handoff → review_task| B1
  B3 -->|pass + next task| A1
  B3 -->|fail| A1
```

```text
Orchestrator = maker + checker (misma sesión)
CLI          = único escritor de evidence + verdict
```

---

## 4. Misma task **con delegación** (L0 / L1)

### Cuándo se enciende

| Capa | Cómo | Efecto |
|------|------|--------|
| **L1** | `local.json` → `execution.delegationEnabled: true` | En cada task de execute/review, el mode **debe** cargar protocol + role |
| **L0** | Tú dices “con delegate implementer / checker” | Solo esa task |
| **Off / sin subagent** | Default o host no puede spawnear | Fallback single-agent (no rompe el forge) |

### Diagrama de una task con delegates

```mermaid
flowchart TB
  START(["handoff: execute_task<br/>nextTaskId = T1.1"]) --> PACK

  PACK["Orchestrator:<br/>context-pack --task T1.1 --json<br/>lee delegationEnabled"]

  PACK --> DEC{¿Delegate?<br/>L1 flag o user pide}

  DEC -->|No| SA_E["Single-agent execute<br/>steps 1–3 del mode"]
  DEC -->|Sí| LOAD_E["MUST load:<br/>delegated-execution.md<br/>+ delegates/implementer.md"]

  LOAD_E --> BRIEF["Brief lean desde task pack<br/>NO full sprint.json"]
  BRIEF --> SPAWN_I["Spawn implementer<br/>host subagent / L2"]
  SPAWN_I --> IMP["Implementer:<br/>código + checks locales<br/>→ status JSON"]
  IMP --> MAP{"status?"}

  MAP -->|in_progress| WAIT["Solo log"]
  MAP -->|blocked| RE_B["CLI record-evidence<br/>--status blocked"]
  MAP -->|done + validation.ok| RE_OK["Orchestrator verifica tree<br/>CLI record-evidence"]
  MAP -->|done débil / sin validation| REJ["Re-brief<br/>NO inventar evidence"]

  SA_E --> RE_OK
  RE_OK --> HANDOFF_R["handoff → review_task"]
  RE_B --> STOP1(["Task blocked"])
  REJ --> BRIEF

  HANDOFF_R --> PACK_R["context-pack --task T1.1"]
  PACK_R --> DEC_R{¿Checker delegate?}

  DEC_R -->|No| SA_R["Single-agent review<br/>+ reviewer.md"]
  DEC_R -->|Sí| LOAD_R["MUST load:<br/>delegated-execution.md<br/>+ delegates/checker.md"]

  LOAD_R --> SPAWN_C["Spawn checker<br/>fresh / independiente"]
  SPAWN_C --> CHK["Checker:<br/>findings JSON only"]
  CHK --> VER["Orchestrator interpreta"]
  SA_R --> VER

  VER --> CLI_R["CLI: review T1.1<br/>--verdict pass|fail --yes"]
  CLI_R --> OUT{verdict}

  OUT -->|pass| NEXT{"¿Más tasks<br/>en el sprint?"}
  OUT -->|fail| BACK["handoff → execute_task<br/>misma o rework"]

  NEXT -->|sí| START2(["nextTaskId = T1.2<br/>loop"])
  NEXT -->|no| CLOSE(["close_sprint"])
  BACK --> START
```

### Matriz de writes (lo que no se puede romper)

```mermaid
flowchart LR
  subgraph MAY["Puede"]
    O["Orchestrator<br/>brief · spawn · CLI · handoff"]
    D["Delegate<br/>código o findings"]
    C["Kyro CLI<br/>record-evidence · review · plan · close"]
  end

  subgraph MUST_NOT["No puede"]
    D2["Delegate<br/>editar sprint.json<br/>self-approve<br/>inventar evidence"]
    O2["Orchestrator<br/>ceder SoT al worker"]
  end

  D -.->|prohibido| D2
  O -.->|prohibido| O2
```

---

## 5. Ejemplo narrado (práctica real)

**Scope:** `oauth-login`  
**Sprint 1:** “Google OAuth end-to-end”  
**Tasks:** `T1.1` routes · `T1.2` callback · `T1.3` session  

### Día 0 — plan

```text
/kyro:forge
Scope: oauth-login — login con Google, sin password legacy.
```

1. INIT crea `.agents/kyro/scopes/oauth-login/sprint.json`
2. `plan_sprint` genera Sprint 1 con T1.1–T1.3  
3. `handoff = { nextAction: execute_task, nextTaskId: T1.1 }`

### Día 1 — T1.1 con L1 (delegation on)

```json
// .agents/kyro/local.json (personal, gitignored)
{ "execution": { "delegationEnabled": true } }
```

```text
/kyro:forge
Continue oauth-login. Run the active task.
```

| Paso | Quién | Qué |
|------|-------|-----|
| 1 | Orch | `context-pack --task` → pack + `delegationEnabled: true` |
| 2 | Orch | Load `delegated-execution.md` + `implementer.md` |
| 3 | **Implementer** | Implementa routes; devuelve `{ status: "done", validation: { ok: true } }` |
| 4 | Orch | Verifica; `record-evidence T1.1 …` (**sin** `--yes`) |
| 5 | Orch | handoff → `review_task` |
| 6 | Orch | Load protocol + `checker.md` |
| 7 | **Checker** | Findings JSON (sin tocar SoT) |
| 8 | Orch | `review T1.1 --verdict pass --yes` |
| 9 | CLI | handoff → `execute_task` / `T1.2` |

### Si no hay subagent

El mode dice: **fallback a steps 1–3 / 1–5**. El forge no se para. Misma task, mismo CLI, sin worker.

### Cierre de sprint

Cuando no quedan tasks pendientes:

```text
close-sprint → archive checkpoint + ledger + limpia activeSprint
```

Siguiente sprint del roadmap → otra vez `plan_sprint`, o `done` si el scope terminó.

---

## 6. Vista “quién carga qué” (tokens / progressive disclosure)

```mermaid
flowchart TB
  subgraph EAGER["Siempre en execute/review path"]
    F["commands/forge.md"]
    O["agents/orchestrator.md"]
    S["sprint-forge/SKILL.md"]
    SP["modes/SPRINT.md"]
    M["execute-task.md XOR review-task.md"]
    RV["reviewer.md solo en review"]
  end

  subgraph LAZY["Solo si opt-in delegate"]
    DE["helpers/delegated-execution.md"]
    IMP["delegates/implementer.md"]
    CHK["delegates/checker.md"]
  end

  M -->|"delegationEnabled o user pide"| DE
  DE --> IMP
  DE --> CHK
```

Por eso slim modes + fail-safe en el mode: el contrato duro vive en el path eager; el protocolo largo solo se paga cuando delegas.

---

## 7. Resumen en una frase

> **Plan** escribe el sprint y las tasks en `sprint.json` → **Execute** hace una task (tú o un implementer) y solo el CLI graba evidence → **Review** valida (tú o un checker) y solo el CLI graba el verdict → el orchestrator **loop**a tasks y cierra el sprint; **nunca** un delegate es dueño del scope ni del `sprint.json`.

---

## Related docs

- [Architecture — Delegated execution](architecture.md#delegated-execution-protocol-opt-in)
- [Getting started — Delegated execution](getting-started.md#delegated-execution-optional)
- [Maker/Checker](maker-checker.md)
- [Teams — L1 opt-in](teams.md#delegation-opt-in-l1)
- [Context management — task packs](context-management.md)
