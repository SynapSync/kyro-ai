# Model Selection Guide

How to choose the right model tier for each Sprint Forge activity, and how to override defaults.

---

## Default Model Assignments

Sprint Forge maps activities to model tiers in `config.json`:

```json
"model_preferences": {
  "exploration": "haiku",
  "planning": "sonnet",
  "implementation": "opus",
  "debugging": "opus",
  "review": "sonnet"
}
```

These values map to the `model` field in each agent definition (`agents/*.md`).

---

## Model Tiers

| Tier | Models | Best For | Cost | Speed |
|------|--------|----------|------|-------|
| **Haiku** | `claude-haiku-4-5` | Read-only exploration, file scanning, pattern matching | Lowest | Fastest |
| **Sonnet** | `claude-sonnet-4-6` | Planning, reviewing, documentation, sprint generation | Medium | Fast |
| **Opus** | `claude-opus-4-6` | Implementation, debugging, complex reasoning, architecture | Highest | Slower |

---

## Activity → Model Mapping

| Activity | Default Tier | Why | Override When |
|----------|-------------|-----|---------------|
| **Exploration** (INIT analysis) | Haiku | Read-only — no reasoning needed, just file scanning | Complex codebase with deep architectural patterns → Sonnet |
| **Planning** (sprint generation) | Sonnet | Needs reasoning for phase design and task decomposition | Very large sprints with 15+ tasks → Opus |
| **Implementation** (code writing) | Opus | Highest quality code, fewest corrections needed | Simple tasks (rename, move files) → Sonnet |
| **Debugging** (root cause analysis) | Opus | Hypothesis-driven investigation needs deep reasoning | Simple test failures with obvious cause → Sonnet |
| **Review** (task validation) | Sonnet | Checklist verification, pattern matching | Security-critical reviews → Opus |

---

## How to Override

### Per-project override

Edit `config.json` in your project's sprint-forge installation:

```json
"model_preferences": {
  "exploration": "sonnet",
  "implementation": "sonnet"
}
```

### Per-session override

When invoking an agent, specify the model in the agent call. The agent definition's `model` field is a suggestion, not a constraint.

### When to use Opus for everything

If cost is not a concern and you want maximum quality:

```json
"model_preferences": {
  "exploration": "opus",
  "planning": "opus",
  "implementation": "opus",
  "debugging": "opus",
  "review": "opus"
}
```

This eliminates any quality tradeoffs but costs ~10x more than the default mixed configuration.

---

## Cost Estimation

Rough cost comparison for a typical sprint (5 phases, 10 tasks):

| Configuration | Exploration | Planning | Implementation | Review | Total (relative) |
|--------------|-------------|----------|---------------|--------|-------------------|
| **Default** (mixed) | Haiku | Sonnet | Opus | Sonnet | 1x |
| **All Sonnet** | Sonnet | Sonnet | Sonnet | Sonnet | 0.6x |
| **All Opus** | Opus | Opus | Opus | Opus | 3x |

---

## Extended Thinking

For complex implementation and debugging tasks, models with extended thinking capabilities produce better results. Extended thinking allows the model to reason through complex problems before responding.

Sprint Forge does not explicitly control extended thinking — it's a model-level capability that activates automatically when the model determines it's beneficial. Using Opus for implementation and debugging tasks gives you the best extended thinking performance.
