#!/usr/bin/env node
const fs = require('fs');
const { findActiveProject } = require('./lib/paths');

console.error('[Kyro] Context compaction triggered.');
console.error('[Kyro] Saving re-entry prompt state before compaction...');
console.error('[Kyro] Run /kyro-workflow:status after compaction to verify context.');

const activeProject = findActiveProject();
if (activeProject) {
  if (fs.existsSync(activeProject.reentryPath)) {
    console.error('[Kyro] Re-entry prompts available at: ' + activeProject.reentryPath);
  } else {
    console.error('[Kyro] WARNING: No re-entry prompts found. Consider generating them.');
  }
} else {
  console.error('[Kyro] No active project detected.');
}

// Pass through stdin
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => console.log(data));
