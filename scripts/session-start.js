#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const rulesPath = path.join(os.homedir(), '.sprint-forge', 'rules.md');
const dbPath = path.join(os.homedir(), '.sprint-forge', 'data.db');

// Load learned rules
if (fs.existsSync(rulesPath)) {
  const rules = fs.readFileSync(rulesPath, 'utf8');
  const ruleCount = (rules.match(/\[RULE-\d+\]/g) || []).length;
  console.error(`[SprintForge] Loaded ${ruleCount} learned rules from ${rulesPath}`);
} else {
  console.error('[SprintForge] No learned rules found. Rules will be captured during sprints.');
}

// Check for active sprint in current directory
const sprintForgeDir = path.join(process.cwd(), '.agents', 'sprint-forge');
if (fs.existsSync(sprintForgeDir)) {
  const sprintsDir = path.join(sprintForgeDir, 'sprints');
  if (fs.existsSync(sprintsDir)) {
    const sprints = fs.readdirSync(sprintsDir).filter(f => f.endsWith('.md')).sort();
    if (sprints.length > 0) {
      const latest = sprints[sprints.length - 1];
      console.error(`[SprintForge] Active project detected. Latest sprint: ${latest}`);
    }
  }
}

// Pass through stdin
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => console.log(data));
