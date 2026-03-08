#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

// Track edit count for quality gate reminders
const stateFile = path.join(os.tmpdir(), 'sprint-forge-edits.json');

let state = { editCount: 0, lastReminder: 0 };
if (fs.existsSync(stateFile)) {
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (e) {
    // Reset on parse error
  }
}

state.editCount++;

// Remind every 5 edits
if (state.editCount - state.lastReminder >= 5) {
  console.error(`[SprintForge] ${state.editCount} edits since session start.`);
  console.error('[SprintForge] Consider pausing for a quality review checkpoint.');
  state.lastReminder = state.editCount;
}

fs.writeFileSync(stateFile, JSON.stringify(state));

// Pass through stdin
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => console.log(data));
