#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Check for active sprint work
const sprintForgeDir = path.join(process.cwd(), '.agents', 'sprint-forge');
if (fs.existsSync(sprintForgeDir)) {
  const sprintsDir = path.join(sprintForgeDir, 'sprints');
  if (fs.existsSync(sprintsDir)) {
    const sprints = fs.readdirSync(sprintsDir).filter(f => f.endsWith('.md')).sort();
    if (sprints.length > 0) {
      const latest = sprints[sprints.length - 1];
      const content = fs.readFileSync(path.join(sprintsDir, latest), 'utf8');
      if (/status:\s*in-progress/i.test(content)) {
        console.error('[SprintForge] Active sprint detected: ' + latest);
        console.error('[SprintForge] Consider running /retro before ending session');
        console.error('[SprintForge] Or update re-entry prompts for the next session');
      }
    }
  }
}

// Pass through stdin
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => console.log(data));
