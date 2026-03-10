#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const kyroDir = path.join(process.cwd(), '.agents', 'kyro-workflow');
const rulesPath = path.join(kyroDir, 'rules.md');
const distDir = path.join(__dirname, '..', 'dist');

// Load learned rules (flat file — always available)
if (fs.existsSync(rulesPath)) {
  const rules = fs.readFileSync(rulesPath, 'utf8');
  const ruleCount = (rules.match(/\[RULE-\d+\]/g) || []).length;
  console.error(`[Kyro] Loaded ${ruleCount} learned rules from ${rulesPath}`);
} else {
  console.error('[Kyro] No learned rules found. Rules will be captured during sprints.');
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
  if (fs.existsSync(kyroDir)) {
    const dirs = fs.readdirSync(kyroDir).filter(f =>
      fs.statSync(path.join(kyroDir, f)).isDirectory() && f !== 'sprints'
    );
    if (dirs.length > 0) {
      const projectDir = path.join(kyroDir, dirs[0], 'sprints');
      if (fs.existsSync(projectDir)) {
        const sprints = fs.readdirSync(projectDir).filter(f => f.endsWith('.md')).sort();
        if (sprints.length > 0) {
          const latest = sprints[sprints.length - 1];
          sprint = latest.replace(/\.md$/, '');
          console.error(`[Kyro] Active project detected. Latest sprint: ${latest}`);
        }
      }
    }
  }

  // Start session in DB
  sessionId = store.startSession(project, sprint);
  console.error(`[Kyro] Session ${sessionId} started (project: ${project})`);

  // Load recent learnings from DB
  const learnings = store.getLearnings(project, 10);
  if (learnings.length > 0) {
    console.error(`[Kyro] ${learnings.length} learnings found in DB for project "${project}"`);
  }

  // Store session ID in temp file for other hooks to use
  const sessionFile = path.join(kyroDir, '.active-session');
  if (!fs.existsSync(kyroDir)) {
    fs.mkdirSync(kyroDir, { recursive: true });
  }
  fs.writeFileSync(sessionFile, JSON.stringify({
    sessionId, project, sprint,
    tasks_completed: 0,
    edit_count: 0,
    corrections_count: 0
  }));

  db.close();
} catch (e) {
  console.error(`[Kyro] DB init skipped: ${e.message}`);
}

// Pass through stdin
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => console.log(data));
