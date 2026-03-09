#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

console.error('[Kyro] Context compaction triggered.');
console.error('[Kyro] Saving re-entry prompt state before compaction...');
console.error('[Kyro] Run /kyro-workflow:status after compaction to verify context.');

// Check for active sprint and remind about re-entry prompts
const kyroDir = path.join(process.cwd(), '.agents', 'kyro');
if (fs.existsSync(kyroDir)) {
  const reentryPath = path.join(kyroDir, 'RE-ENTRY-PROMPTS.md');
  if (fs.existsSync(reentryPath)) {
    console.error('[Kyro] Re-entry prompts available at: ' + reentryPath);
  } else {
    console.error('[Kyro] WARNING: No re-entry prompts found. Consider generating them.');
  }
}

// Pass through stdin
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => console.log(data));
