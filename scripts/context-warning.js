#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

console.error('[SprintForge] Context compaction triggered.');
console.error('[SprintForge] Saving re-entry prompt state before compaction...');
console.error('[SprintForge] Run /sprint-forge:status after compaction to verify context.');

// Check for active sprint and remind about re-entry prompts
const sprintForgeDir = path.join(process.cwd(), '.agents', 'sprint-forge');
if (fs.existsSync(sprintForgeDir)) {
  const reentryPath = path.join(sprintForgeDir, 'RE-ENTRY-PROMPTS.md');
  if (fs.existsSync(reentryPath)) {
    console.error('[SprintForge] Re-entry prompts available at: ' + reentryPath);
  } else {
    console.error('[SprintForge] WARNING: No re-entry prompts found. Consider generating them.');
  }
}

// Pass through stdin
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => console.log(data));
