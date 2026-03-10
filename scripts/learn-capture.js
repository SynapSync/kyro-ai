#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { getKyroDir, getRulesPath, getDistDir, getActiveSessionPath, debugLog, writeJsonAtomic } = require('./lib/paths');

const kyroDir = getKyroDir();
const sessionFile = getActiveSessionPath();

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const message = input.last_assistant_message || '';

    // Look for [LEARN] blocks in the response
    const learnPattern = /\[LEARN\]\s*([^:\n]+):\s*(.+)/g;
    let match;
    const learnings = [];

    while ((match = learnPattern.exec(message)) !== null) {
      learnings.push({
        category: match[1].trim(),
        rule: match[2].trim()
      });
    }

    if (learnings.length > 0) {
      const rulesPath = getRulesPath();

      if (!fs.existsSync(kyroDir)) {
        fs.mkdirSync(kyroDir, { recursive: true });
      }

      let rules = '';
      if (fs.existsSync(rulesPath)) {
        rules = fs.readFileSync(rulesPath, 'utf8');
      } else {
        rules = '# Kyro — Learned Rules\n\n';
      }

      // Find next rule number
      const ruleNumbers = (rules.match(/\[RULE-(\d+)\]/g) || [])
        .map(r => parseInt(r.match(/\d+/)[0]));
      let nextNum = ruleNumbers.length > 0 ? Math.max(...ruleNumbers) + 1 : 1;

      // Read active session for project/sprint context
      let project = path.basename(process.cwd());
      let sprint = null;
      try {
        if (fs.existsSync(sessionFile)) {
          const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
          project = sessionData.project || project;
          sprint = sessionData.sprint || null;
        }
      } catch (e) { debugLog('learn-capture session read: ' + e.message); }

      // Persist to DB (dual-write: rules.md + database)
      let store = null;
      let db = null;
      try {
        const distDir = getDistDir();
        const { initDatabase } = require(path.join(distDir, 'db', 'index.js'));
        const { createStore } = require(path.join(distDir, 'db', 'store.js'));
        db = initDatabase();
        store = createStore(db);
      } catch (e) { debugLog('learn-capture DB init: ' + e.message); }

      learnings.forEach(l => {
        const date = new Date().toISOString().split('T')[0];
        const ruleEntry = `- [RULE-${String(nextNum).padStart(3, '0')}] ${l.rule} (${date})\n`;

        const categoryHeader = `## ${l.category}`;
        if (rules.includes(categoryHeader)) {
          rules = rules.replace(categoryHeader, `${categoryHeader}\n${ruleEntry}`);
        } else {
          rules += `\n${categoryHeader}\n${ruleEntry}`;
        }

        if (store) {
          try {
            store.addLearning({
              project,
              category: l.category,
              rule: l.rule,
              mistake: null,
              correction: null,
              sprint
            });
          } catch (e) { debugLog('learn-capture addLearning: ' + e.message); }
        }

        console.error(`[Kyro] Captured: [RULE-${String(nextNum).padStart(3, '0')}] ${l.category}: ${l.rule}`);
        nextNum++;
      });

      fs.writeFileSync(rulesPath, rules);

      // Increment corrections_count in .active-session
      try {
        if (fs.existsSync(sessionFile)) {
          const sd = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
          sd.corrections_count = (sd.corrections_count || 0) + learnings.length;
          writeJsonAtomic(sessionFile, sd);
        }
      } catch (e) { debugLog('learn-capture session write: ' + e.message); }

      if (db) db.close();
    }
  } catch (e) {
    debugLog('learn-capture: ' + e.message);
  }

  console.log(data);
});
