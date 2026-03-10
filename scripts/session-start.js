#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { getKyroDir, getRulesPath, getDistDir, getActiveSessionPath, findActiveProject } = require('./lib/paths');

const kyroDir = getKyroDir();
const rulesPath = getRulesPath();

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
  const distDir = getDistDir();
  const { initDatabase } = require(path.join(distDir, 'db', 'index.js'));
  const { createStore } = require(path.join(distDir, 'db', 'store.js'));

  const db = initDatabase();
  const store = createStore(db);

  // Detect project name from cwd
  const project = path.basename(process.cwd());

  // Detect active sprint via shared path module
  let sprint = null;
  let projectDir = null;
  const activeProject = findActiveProject();
  if (activeProject && fs.existsSync(activeProject.sprintsDir)) {
    const { findLatestSprint } = require('./lib/paths');
    const latest = findLatestSprint(activeProject.sprintsDir);
    if (latest) {
      sprint = latest.file.replace(/\.md$/, '');
      projectDir = activeProject.dir;
      console.error(`[Kyro] Active project detected. Latest sprint: ${latest.file}`);
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

  // Check for aged debt items
  let debtThreshold = 3;
  try {
    const configPath = path.join(__dirname, '..', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      debtThreshold = config.sprint?.debt_aged_threshold_sprints ?? 3;
    }
  } catch (_) {}
  const agedDebt = store.getAgedDebt(project, debtThreshold);
  if (agedDebt.length > 0) {
    console.error(`[Kyro] ${agedDebt.length} aged debt item(s) detected:`);
    for (const d of agedDebt) {
      console.error(`[Kyro]   Aged debt: ${d.item} (open since ${d.sprint_created || 'unknown'})`);
    }
  }

  // Store session ID in temp file for other hooks to use
  const sessionFile = getActiveSessionPath();
  if (!fs.existsSync(kyroDir)) {
    fs.mkdirSync(kyroDir, { recursive: true });
  }
  fs.writeFileSync(sessionFile, JSON.stringify({
    sessionId, project, sprint, projectDir,
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
