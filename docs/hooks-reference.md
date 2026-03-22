# Hooks Reference

Kyro defines 12 lifecycle hooks that fire automatically during Claude Code sessions. Hooks are implemented as Node.js scripts that receive JSON via stdin and emit JSON via stdout, following the Claude Code hook protocol.

---

## Hook Definitions

All hooks are defined in `hooks/hooks.json` and their implementation scripts live in `scripts/`.

---

### 1. SessionStart

**When it fires:** At the beginning of every new Claude Code session.

**What the script does:**
- Loads learned rules from `.agents/sprint-forge/rules.md`
- Displays a summary of the active sprint (if one exists)
- Initializes session tracking

**Script:** `scripts/session-start.js`

**Matcher:** `*` (fires for all sessions)

---

### 2. PreToolUse (Edit/Write)

**When it fires:** Before any `Edit` or `Write` tool call.

**What the script does:**
- Increments the edit counter for the current session
- Triggers quality gate reminders when edit count reaches thresholds

**Script:** `scripts/quality-gate.js`

**Matcher:** `tool == "Edit" || tool == "Write"`

---

### 3. PreToolUse (git commit)

**When it fires:** Before any Bash command that contains `git commit`.

**What the script does:**
- Emits a stderr reminder to run quality gates before committing
- Reminds about lint, typecheck, tests, and review checklist

**Script:** Inline Node.js one-liner

**Matcher:** `tool == "Bash" && tool_input.command matches "git commit"`

---

### 4. PostToolUse (Code Edits)

**When it fires:** After any `Edit` tool call on a source code file (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.dart`).

**What the script does:**
- Scans for debug artifacts (`console.log`, `debugger`, `print`)
- Checks for hardcoded secrets
- Flags new TODOs introduced in the edit

**Script:** `scripts/post-edit-check.js`

**Matcher:** `tool == "Edit" && tool_input.file_path matches "\\.(ts|tsx|js|jsx|py|go|rs|dart)$"`

---

### 5. PostToolUse (Test Runs)

**When it fires:** After any Bash command that runs tests (`npm test`, `pnpm test`, `yarn test`, `pytest`, `go test`, `dart test`, `flutter test`).

**What the script does:**
- Parses test output for failure indicators (`fail`, `error`, `FAIL`)
- If failures detected, suggests invoking the debug protocol for root cause analysis
- Extracts and reports the first failing line

**Script:** Inline Node.js one-liner

**Matcher:** `tool == "Bash" && tool_input.command matches "(npm test|pnpm test|yarn test|pytest|go test|dart test|flutter test)"`

---

### 6. Stop (Session Check)

**When it fires:** After each Claude Code response (the "Stop" event).

**What the script does:**
- Checks session context: reminds to save re-entry prompts if a sprint is active
- Suggests running the retrospective phase if the sprint appears complete
- Provides context-aware reminders based on current workflow state

**Script:** `scripts/session-check.js`

**Matcher:** `*`

---

### 7. Stop (Learn Capture)

**When it fires:** After each Claude Code response (the "Stop" event).

**What the script does:**
- Scans the response for `[LEARN]` blocks
- Auto-captures identified learnings into `.agents/sprint-forge/rules.md`
- Formats captures with date and project context

**Script:** `scripts/learn-capture.js`

**Matcher:** `*`

---

### 8. SessionEnd

**When it fires:** When the Claude Code session is closing.

**What the script does:**
- Prompts for any final learnings to capture
- Updates `.agents/sprint-forge/rules.md` with confirmed rules
- Saves session statistics to the database (edit count, corrections, tasks completed)

**Script:** `scripts/session-end.js`

**Matcher:** `*`

---

### 9. UserPromptSubmit (Drift Detection)

**When it fires:** When the user submits a new prompt.

**What the script does:**
- During sprint execution, detects if the user's prompt drifts away from the current task
- Reminds about the active task to prevent scope drift
- Helps maintain focus during sprint execution

**Script:** `scripts/drift-detector.js`

**Matcher:** `*`

---

### 10. UserPromptSubmit (Rule Checker)

**When it fires:** When the user submits a new prompt.

**What the script does:**
- Checks if the prompt or resulting action is about to violate a learned rule
- Warns the user before the violation occurs
- References the specific rule from `.agents/sprint-forge/rules.md`

**Script:** `scripts/rule-checker.js`

**Matcher:** `*`

---

### 11. PreCompact

**When it fires:** Before Claude Code compacts the conversation context (when the context window fills up).

**What the script does:**
- Saves the current re-entry state before context is lost
- Writes re-entry prompts so the session can be recovered
- Preserves sprint progress and mental context

**Script:** `scripts/context-warning.js`

**Matcher:** `*`

---

### 12. SubagentStart / SubagentStop

**When they fire:** When a subagent starts or finishes execution.

**What the scripts do:**
- Log the agent name and lifecycle event for observability
- Enable sprint-level tracking of which agents were invoked and when

**Script:** Inline Node.js one-liners

**Matcher:** `*`

---

### 13. TaskCompleted

**When it fires:** When a task is marked as completed during sprint execution.

**What the script does:**
- Runs the review checklist automatically
- Updates the sprint checkpoint file
- Records task completion in session statistics

**Script:** `scripts/task-complete.js`

**Matcher:** `*`

---

### 14. PostToolUseFailure

**When it fires:** When any tool call fails.

**What the script does:**
- Logs the failed tool name
- Suggests invoking the debug protocol for investigation
- Helps catch and respond to unexpected failures during sprint execution

**Script:** Inline Node.js one-liner

**Matcher:** `*`

---

## Hook Lifecycle Diagram

```
Session Start
  |
  v
[SessionStart] --> Load rules, show active sprint
  |
  v
User submits prompt
  |
  v
[UserPromptSubmit] --> Drift detection + Rule violation check
  |
  v
Agent processes prompt
  |
  +---> Before tool call
  |       |
  |       v
  |     [PreToolUse] --> Track edits (Edit/Write) or remind quality gates (git commit)
  |       |
  |       v
  |     Tool executes
  |       |
  |       +---> Success
  |       |       |
  |       |       v
  |       |     [PostToolUse] --> Check for debug artifacts (code edits)
  |       |                       or detect test failures (test runs)
  |       |
  |       +---> Failure
  |               |
  |               v
  |             [PostToolUseFailure] --> Suggest debug protocol
  |
  +---> Subagent invoked
  |       |
  |       v
  |     [SubagentStart] --> Log agent start
  |       |
  |       v
  |     Subagent runs...
  |       |
  |       v
  |     [SubagentStop] --> Log agent completion
  |
  +---> Task completed
  |       |
  |       v
  |     [TaskCompleted] --> Run review checklist, update checkpoint
  |
  v
Agent responds
  |
  v
[Stop] --> Session check + Learn capture
  |
  v
Context filling up?
  |
  +---> Yes: [PreCompact] --> Save re-entry state
  |
  v
Session ending?
  |
  +---> Yes: [SessionEnd] --> Save stats, prompt for learnings
```

---

## Customizing Hook Behavior via config.json

Several hooks read configuration from `config.json` to determine their behavior:

### Quality Gates

```json
{
  "quality_gates": {
    "run_lint": true,
    "run_typecheck": true,
    "run_tests": true,
    "lint_command": "npm run lint",
    "typecheck_command": "npm run typecheck",
    "test_command": "npm test -- --related"
  }
}
```

Set `run_lint`, `run_typecheck`, or `run_tests` to `false` to disable specific quality gate checks. Override the commands to match your project's tooling.

### Sprint Checkpointing

```json
{
  "sprint": {
    "checkpoint_per_phase": true,
    "require_retro": true,
    "debt_aged_threshold_sprints": 3,
    "max_tasks_per_sprint": 10
  }
}
```

- `checkpoint_per_phase`: When `true`, the sprint file is saved after each phase completes. When `false`, saves only at sprint close.
- `require_retro`: When `true`, the sprint cannot be closed without running the retro.
- `debt_aged_threshold_sprints`: Number of sprints before open debt triggers an escalation.

### Rules and Learning

```json
{
  "rules": {
    "path": ".agents/sprint-forge/rules.md",
    "auto_load": true,
    "require_approval": true
  },
  "self_correction": {
    "enabled": true,
    "require_approval": true,
    "learned_file": ".agents/sprint-forge/rules.md"
  }
}
```

- `auto_load`: When `true`, rules are loaded automatically at session start.
- `require_approval`: When `true`, new rules must be approved by the user before being saved.

### Context Management

```json
{
  "context": {
    "warning_threshold_percent": 70,
    "auto_save_reentry": true
  }
}
```

- `warning_threshold_percent`: At what percentage of context usage to start warning.
- `auto_save_reentry`: Automatically save re-entry state when context approaches limits.

---

## How to Add Custom Hooks

To add a custom hook:

### Step 1: Create the Script

Create a Node.js script in `scripts/`:

```javascript
// scripts/my-custom-hook.js
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  const input = JSON.parse(data);

  // Your hook logic here
  // Use console.error() for messages shown to the user
  console.error('[Kyro] Custom hook fired');

  // Output the (possibly modified) input as JSON
  console.log(data);
});
```

The script receives the hook event as JSON on stdin and must output JSON on stdout. Use `console.error()` for user-visible messages (stderr is displayed, stdout is consumed by Claude Code).

### Step 2: Register in hooks.json

Add the hook definition to `hooks/hooks.json`:

```json
{
  "Stop": [
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/my-custom-hook.js\""
        }
      ],
      "description": "Description of what this hook does"
    }
  ]
}
```

### Step 3: Choose the Right Event

| Event | Best For |
|-------|----------|
| `SessionStart` | Initialization, loading state |
| `PreToolUse` | Validation before actions, tracking |
| `PostToolUse` | Checking results, detecting issues |
| `Stop` | Post-response checks, capturing learnings |
| `SessionEnd` | Cleanup, saving state |
| `UserPromptSubmit` | Input validation, drift detection |
| `PreCompact` | State preservation before context loss |
| `SubagentStart/Stop` | Agent lifecycle tracking |
| `TaskCompleted` | Post-task validation |
| `PostToolUseFailure` | Error handling, recovery suggestions |

### Step 4: Use Matchers

Matchers filter when a hook fires:

- `*` -- fires for all events of that type
- `tool == "Edit"` -- fires only for Edit tool calls
- `tool == "Bash" && tool_input.command matches "git commit"` -- fires for specific Bash commands
- `tool == "Edit" && tool_input.file_path matches "\\.(ts|tsx)$"` -- fires for edits to specific file types
