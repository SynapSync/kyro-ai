#!/usr/bin/env node
const fs = require('fs');
const { getActiveSessionPath, debugLog, writeJsonAtomic } = require('./lib/paths');

const sessionFile = getActiveSessionPath();

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const agentName = input.agent_name || input.task_id || 'unknown';
    const kyroAgents = ['explorer', 'reviewer', 'debugger', 'orchestrator'];
    const isKyroAgent = kyroAgents.some(a => agentName.toLowerCase().includes(a));

    console.error(`[Kyro] Agent finished: ${agentName}`);
    if (isKyroAgent) {
      console.error('[Kyro] Running post-task quality checklist:');
      console.error('  □ Tests passing?');
      console.error('  □ No debug statements?');
      console.error('  □ No hardcoded secrets?');
      console.error('  □ Debt table updated?');
      console.error('[Kyro] Use reviewer agent for full validation.');
    }

    // Increment tasks_completed in active session
    try {
      if (fs.existsSync(sessionFile)) {
        const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
        sessionData.tasks_completed = (sessionData.tasks_completed || 0) + 1;
        writeJsonAtomic(sessionFile, sessionData);

        console.error(`[Kyro] Session tasks completed: ${sessionData.tasks_completed}`);
      }
    } catch (e) { debugLog('task-complete session write: ' + e.message); }
  } catch (e) {
    console.error('[Kyro] Task completed. Run quality checks.');
  }

  console.log(data);
});
