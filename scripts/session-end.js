#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const forgeDir = path.join(os.homedir(), '.sprint-forge');

// Ensure directory exists
if (!fs.existsSync(forgeDir)) {
  fs.mkdirSync(forgeDir, { recursive: true });
}

console.error('[SprintForge] Session ending.');
console.error('[SprintForge] Did you capture any learnings this session?');
console.error('[SprintForge] Use /retro to run a retrospective before closing.');

// Pass through stdin
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => console.log(data));
