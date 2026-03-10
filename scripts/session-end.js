#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const kyroDir = path.join(process.cwd(), '.agents', 'kyro');
const distDir = path.join(__dirname, '..', 'dist');
const sessionFile = path.join(kyroDir, '.active-session');

// Ensure directory exists
if (!fs.existsSync(kyroDir)) {
  fs.mkdirSync(kyroDir, { recursive: true });
}

// End session in DB
try {
  if (fs.existsSync(sessionFile)) {
    const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    const { initDatabase } = require(path.join(distDir, 'db', 'index.js'));
    const { createStore } = require(path.join(distDir, 'db', 'store.js'));

    const db = initDatabase();
    const store = createStore(db);

    store.endSession(sessionData.sessionId, {
      edit_count: sessionData.edit_count || 0,
      corrections_count: sessionData.corrections_count || 0,
      tasks_completed: sessionData.tasks_completed || 0,
      tasks_total: sessionData.tasks_total || 0
    });

    console.error(`[Kyro] Session ${sessionData.sessionId} closed with stats: ${sessionData.tasks_completed || 0} tasks completed.`);

    db.close();
    fs.unlinkSync(sessionFile);
  }
} catch (e) {
  console.error(`[Kyro] DB session close skipped: ${e.message}`);
}

console.error('[Kyro] Session ending.');
console.error('[Kyro] Did you capture any learnings this session?');
console.error('[Kyro] Use /retro to run a retrospective before closing.');

// Pass through stdin
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => console.log(data));
