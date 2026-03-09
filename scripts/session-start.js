#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const rulesPath = path.join(os.homedir(), '.sprint-forge', 'rules.md');
const distDir = path.join(__dirname, '..', 'dist');

// Load learned rules (flat file — always available)
if (fs.existsSync(rulesPath)) {
  const rules = fs.readFileSync(rulesPath, 'utf8');
  const ruleCount = (rules.match(/\[RULE-\d+\]/g) || []).length;
  console.error(`[SprintForge] Loaded ${ruleCount} learned rules from ${rulesPath}`);
} else {
  console.error('[SprintForge] No learned rules found. Rules will be captured during sprints.');
}

// Initialize database and start session
let sessionId = null;
try {
  const { initDatabase } = require(path.join(distDir, 'db', 'index.js'));
  const { createStore } = require(path.join(distDir, 'db', 'store.js'));

  const db = initDatabase();
  const store = createStore(db);

  // Detect project name from cwd
  const project = path.basename(process.cwd());

  // Detect active sprint
  let sprint = null;
  const sprintForgeDir = path.join(process.cwd(), '.agents', 'sprint-forge');
  if (fs.existsSync(sprintForgeDir)) {
    const dirs = fs.readdirSync(sprintForgeDir).filter(f =>
      fs.statSync(path.join(sprintForgeDir, f)).isDirectory() && f !== 'sprints'
    );
    if (dirs.length > 0) {
      const projectDir = path.join(sprintForgeDir, dirs[0], 'sprints');
      if (fs.existsSync(projectDir)) {
        const sprints = fs.readdirSync(projectDir).filter(f => f.endsWith('.md')).sort();
        if (sprints.length > 0) {
          const latest = sprints[sprints.length - 1];
          sprint = latest.replace(/\.md$/, '');
          console.error(`[SprintForge] Active project detected. Latest sprint: ${latest}`);
        }
      }
    }
  }

  // Start session in DB
  sessionId = store.startSession(project, sprint);
  console.error(`[SprintForge] Session ${sessionId} started (project: ${project})`);

  // Load recent learnings from DB
  const learnings = store.getLearnings(project, 10);
  if (learnings.length > 0) {
    console.error(`[SprintForge] ${learnings.length} learnings found in DB for project "${project}"`);
  }

  // Store session ID in temp file for other hooks to use
  const sessionFile = path.join(os.homedir(), '.sprint-forge', '.active-session');
  fs.writeFileSync(sessionFile, JSON.stringify({
    sessionId, project, sprint,
    tasks_completed: 0,
    edit_count: 0,
    corrections_count: 0
  }));

  db.close();
} catch (e) {
  console.error(`[SprintForge] DB init skipped: ${e.message}`);
}

// Pass through stdin
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => console.log(data));
