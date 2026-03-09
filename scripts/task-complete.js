#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const distDir = path.join(__dirname, '..', 'dist');
const sessionFile = path.join(os.homedir(), '.sprint-forge', '.active-session');

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const taskId = input.task_id || 'unknown';

    console.error(`[SprintForge] Task completed: ${taskId}`);
    console.error('[SprintForge] Running post-task quality checklist:');
    console.error('  □ Tests passing?');
    console.error('  □ No debug statements?');
    console.error('  □ No hardcoded secrets?');
    console.error('  □ Debt table updated?');
    console.error('[SprintForge] Use reviewer agent for full validation.');

    // Increment tasks_completed in active session
    try {
      if (fs.existsSync(sessionFile)) {
        const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
        sessionData.tasks_completed = (sessionData.tasks_completed || 0) + 1;
        fs.writeFileSync(sessionFile, JSON.stringify(sessionData));

        console.error(`[SprintForge] Session tasks completed: ${sessionData.tasks_completed}`);
      }
    } catch (_) {}
  } catch (e) {
    console.error('[SprintForge] Task completed. Run quality checks.');
  }

  console.log(data);
});
