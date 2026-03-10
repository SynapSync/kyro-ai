#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getActiveSessionPath } = require('./lib/paths');

// Track edit count for quality gate reminders (temp file)
const stateFile = path.join(os.tmpdir(), 'kyro-workflow-edits.json');

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
  console.error(`[Kyro] ${state.editCount} edits since session start.`);
  console.error('[Kyro] Consider pausing for a quality review checkpoint.');
  state.lastReminder = state.editCount;
}

fs.writeFileSync(stateFile, JSON.stringify(state));

// Also track edit_count in .active-session for DB persistence
const sessionFile = getActiveSessionPath();
try {
  if (fs.existsSync(sessionFile)) {
    const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    sessionData.edit_count = (sessionData.edit_count || 0) + 1;
    fs.writeFileSync(sessionFile, JSON.stringify(sessionData));
  }
} catch (_) {}

// Pass through stdin
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => console.log(data));
