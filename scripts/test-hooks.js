#!/usr/bin/env node

/**
 * Hook smoke test — verifies each hook script:
 * 1. Accepts valid JSON on stdin
 * 2. Exits with code 0
 * 3. Outputs valid JSON on stdout (passthrough)
 *
 * Used by CI to catch syntax errors and crashes in hook scripts.
 * DB-dependent hooks gracefully degrade (try/catch), so no DB setup needed.
 */

const { execSync } = require('child_process');
const path = require('path');

const scriptsDir = __dirname;

const hooks = [
  {
    name: 'session-start',
    file: 'session-start.js',
    stdin: JSON.stringify({ event: 'SessionStart' })
  },
  {
    name: 'quality-gate (PreToolUse)',
    file: 'quality-gate.js',
    stdin: JSON.stringify({ tool: 'Edit', tool_input: { file_path: 'test.ts', new_string: 'const x = 1;' } })
  },
  {
    name: 'post-edit-check (PostToolUse)',
    file: 'post-edit-check.js',
    stdin: JSON.stringify({ tool: 'Edit', tool_input: { file_path: 'test.ts', new_string: 'const x = 1;' } })
  },
  {
    name: 'session-check (Stop)',
    file: 'session-check.js',
    stdin: JSON.stringify({ event: 'Stop' })
  },
  {
    name: 'learn-capture (Stop)',
    file: 'learn-capture.js',
    stdin: JSON.stringify({ last_assistant_message: 'Some response without learn blocks' })
  },
  {
    name: 'task-complete (TaskCompleted)',
    file: 'task-complete.js',
    stdin: JSON.stringify({ task_id: 'test-task-1' })
  },
  {
    name: 'drift-detector (UserPromptSubmit)',
    file: 'drift-detector.js',
    stdin: JSON.stringify({ user_message: 'implement the next task' })
  },
  {
    name: 'rule-checker (UserPromptSubmit)',
    file: 'rule-checker.js',
    stdin: JSON.stringify({ user_message: 'fix the login bug' })
  },
  {
    name: 'context-warning (PreCompact)',
    file: 'context-warning.js',
    stdin: JSON.stringify({ event: 'PreCompact' })
  },
  {
    name: 'session-end',
    file: 'session-end.js',
    stdin: JSON.stringify({ event: 'SessionEnd' })
  }
];

let passed = 0;
let failed = 0;

for (const hook of hooks) {
  const scriptPath = path.join(scriptsDir, hook.file);
  try {
    const stdout = execSync(`echo '${hook.stdin.replace(/'/g, "'\\''")}' | node "${scriptPath}"`, {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Verify output is valid JSON (passthrough)
    JSON.parse(stdout.trim());

    console.log(`  PASS  ${hook.name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${hook.name}: ${e.message.split('\n')[0]}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed, ${hooks.length} total`);

if (failed > 0) {
  process.exit(1);
}
