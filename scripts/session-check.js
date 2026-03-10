#!/usr/bin/env node
const { findActiveProject, findLatestSprint } = require('./lib/paths');

const activeProject = findActiveProject();
if (activeProject) {
  const latest = findLatestSprint(activeProject.sprintsDir);
  if (latest && /status:\s*["']?active["']?/i.test(latest.content)) {
    console.error('[Kyro] Active sprint detected: ' + latest.file);
    console.error('[Kyro] Consider running /retro before ending session');
    console.error('[Kyro] Or update re-entry prompts for the next session');
  }
}

// Pass through stdin
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => console.log(data));
