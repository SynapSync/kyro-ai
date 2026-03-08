# Rules Guide -- Cross-Project Learning System

Sprint Forge accumulates knowledge across projects through a persistent rules file at `~/.sprint-forge/rules.md`. Rules capture corrections, patterns, and estimation insights so that mistakes made once are never repeated.

---

## How Rules Are Captured

The learning flow moves from correction to persistent rule in four steps:

```
1. User corrects the agent during a sprint
       |
       v
2. Agent proposes a rule based on the correction
       |
       v
3. User approves (or edits) the proposed rule
       |
       v
4. Rule is appended to ~/.sprint-forge/rules.md
```

### Detection

Rules are captured from two sources:

- **Explicit corrections** -- the user tells the agent it did something wrong. These have the highest confidence.
- **Pattern detection** -- the agent identifies a recurring pattern worth codifying (e.g., "DB migration tasks consistently take 40% longer than estimated"). These are proactive suggestions with lower confidence.

### Proposal Format

When a correction or pattern is detected, the agent proposes a rule:

```
Detected a pattern worth remembering:

[RULE-XXX] Category: One-line rule
  Context: Why this rule exists
  Source: Sprint N, Project: project-name

Save this rule? (yes/no/edit)
```

The user can:
- **yes** -- save the rule as proposed
- **no** -- discard the proposal
- **edit** -- modify the rule text before saving

### Storage

Approved rules are appended to `~/.sprint-forge/rules.md` and logged in the sprint's `LEARNED` section.

---

## Rule Format and Categories

Rules follow a standard format with categories that determine when they are applied.

### Format

Each rule is a single line with structured metadata:

```
- [RULE-NNN] One-line actionable rule (YYYY-MM-DD, project: project-name)
```

Components:
- `RULE-NNN` -- unique sequential identifier
- Rule text -- specific, actionable instruction
- Date -- when the rule was learned
- Project -- where the rule was learned (for traceability)

### Categories

Rules are organized into categories that correspond to different phases of sprint execution:

```markdown
# Sprint Forge -- Learned Rules

## Estimation
- [RULE-001] DB migration tasks: add 20% buffer to estimates (2026-02-20, project: nebux-api)
- [RULE-002] Auth tasks frequently reveal hidden dependencies (2026-02-22, project: nebux-api)

## Quality
- [RULE-003] Always validate version compatibility before adding dependencies (2026-02-25, project: synap-sync)

## Architecture
- [RULE-004] Extract shared validation logic before 3rd duplication (2026-03-01, project: skills-registry)

## Testing
- [RULE-005] E2E tests for auth flows catch integration issues that unit tests miss (2026-03-03, project: nebux-api)

## Process
- [RULE-006] Run full quality gates before closing sprint, not just per-task (2026-03-05, project: synap-sync)
```

| Category | Applied During | Examples |
|----------|---------------|----------|
| **Estimation** | Sprint generation (Phase 2) | Buffer adjustments, complexity flags |
| **Quality** | Task execution and review (Phase 3) | Validation steps, dependency checks |
| **Architecture** | Analysis and planning (Phase 1-2) | Pattern preferences, boundary rules |
| **Testing** | Task validation (Phase 3) | Test strategy, coverage requirements |
| **Process** | All phases | Workflow preferences, gate behavior |

---

## How Rules Are Loaded and Applied

### Loading

At the start of every session, the `SessionStart` hook:

1. Reads `~/.sprint-forge/rules.md` (path configurable in `config.json`)
2. Parses all active rules
3. Makes them available to all agents for the session

Loading is automatic when `config.json` has `rules.auto_load: true` (the default).

### Application

Rules are applied contextually based on their category:

- **Before generating sprint estimates** -- check Estimation rules. If a rule applies (e.g., "DB migration tasks: add 20% buffer"), adjust the estimate and note the adjustment.
- **Before architecture decisions** -- check Architecture rules. If a rule applies, follow it or explicitly justify deviation.
- **During task execution** -- check Quality and Testing rules. If a rule is about to be violated, pause and show the rule to the user.
- **During sprint planning** -- check Process rules.

### Rule Violation Warning

When the agent is about to violate a learned rule, the `UserPromptSubmit` hook triggers a warning:

```
[SprintForge] Rule violation detected:
  [RULE-003] Always validate version compatibility before adding dependencies
  Source: 2026-02-25, project: synap-sync

The current action appears to skip version validation.
Proceed anyway? (yes/no)
```

### Application Tracking

Each time a rule is applied, its `times_applied` counter is incremented in the database. This helps identify which rules are providing the most value.

---

## Managing Rules

### Deprecating a Rule

When a rule is no longer relevant (technology changed, project context shifted), mark it as deprecated:

```markdown
## Estimation
- [RULE-001] DB migration tasks: add 20% buffer to estimates (2026-02-20, project: nebux-api)
- ~~[RULE-002] Auth tasks frequently reveal hidden dependencies (2026-02-22, project: nebux-api)~~ [DEPRECATED: auth module rewritten in Sprint 5]
```

Deprecated rules are kept for history but are no longer applied.

### Evolving a Rule

When a rule needs updating based on new experience, create a new rule that references the original:

```markdown
## Estimation
- ~~[RULE-001] DB migration tasks: add 20% buffer to estimates~~ [EVOLVED -> RULE-015]
- [RULE-015] DB migration tasks: add 30% buffer when involving foreign key changes, 20% otherwise (2026-03-08, project: nebux-api, evolved from RULE-001)
```

### Consolidating Rules

After accumulating many rules, related rules can be consolidated:

```markdown
## Estimation
- ~~[RULE-001] DB migration tasks: add 20% buffer~~ [CONSOLIDATED -> RULE-020]
- ~~[RULE-002] Auth tasks: reveal hidden dependencies~~ [CONSOLIDATED -> RULE-020]
- [RULE-020] Complex backend tasks (DB migrations, auth, payments): add 20-30% buffer and check for hidden dependencies before estimating (2026-03-08, consolidated from RULE-001, RULE-002)
```

### Rule Limits

The sprint-learner skill enforces a maximum of **50 active rules**. When approaching this limit:
- Review rules by `times_applied` -- rarely-applied rules may be candidates for deprecation
- Consolidate related rules into broader, more useful ones
- Deprecate rules tied to completed or abandoned projects

---

## Example rules.md File

```markdown
# Sprint Forge -- Learned Rules

> Accumulated rules from sprint execution across all projects.
> Loaded automatically at session start. Applied contextually by category.
> Maximum 50 active rules. Deprecate or consolidate when approaching limit.

## Estimation
- [RULE-001] DB migration tasks: add 20% buffer to estimates (2026-02-20, project: nebux-api)
- [RULE-002] Auth tasks frequently reveal hidden dependencies -- add 20% buffer (2026-02-22, project: nebux-api)
- [RULE-008] UI animation tasks take 2x longer when involving cross-platform support (2026-03-05, project: mobile-app)

## Quality
- [RULE-003] Always validate version compatibility before adding dependencies (2026-02-25, project: synap-sync)
- [RULE-009] Never use string concatenation for SQL queries -- always parameterized (2026-03-06, project: nebux-api)

## Architecture
- [RULE-004] Extract shared validation logic before 3rd duplication (2026-03-01, project: skills-registry)
- [RULE-010] Prefer composition over inheritance for middleware chains (2026-03-06, project: nebux-api)

## Testing
- [RULE-005] E2E tests for auth flows catch integration issues that unit tests miss (2026-03-03, project: nebux-api)
- [RULE-011] Always test error paths, not just happy paths (2026-03-07, project: synap-sync)

## Process
- [RULE-006] Run full quality gates before closing sprint, not just per-task (2026-03-05, project: synap-sync)
- [RULE-007] Always validate version compatibility before adding new dependencies (2026-03-05, project: synap-sync)
- ~~[RULE-012] Use npm ci instead of npm install in CI pipelines (2026-03-07, project: nebux-api)~~ [DEPRECATED: migrated to pnpm]
```

---

## Rules in the Database

In addition to the `rules.md` file, learnings are stored in the SQLite database (`~/.sprint-forge/data.db`) in the `learnings` table:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-incrementing primary key |
| `created_at` | TEXT | Timestamp when the rule was learned |
| `project` | TEXT | Project where the rule was learned |
| `category` | TEXT | Rule category (estimation, quality, architecture, testing, process) |
| `rule` | TEXT | The rule text |
| `mistake` | TEXT | What went wrong (if captured from a correction) |
| `correction` | TEXT | What the user said to correct the agent |
| `sprint` | TEXT | Sprint where the rule was learned |
| `times_applied` | INTEGER | How many times this rule has been applied |

The database also provides full-text search via FTS5 with BM25 ranking, allowing agents to search for relevant past learnings by keyword.
