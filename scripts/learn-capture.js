#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

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
      const rulesDir = path.join(os.homedir(), '.sprint-forge');
      const rulesPath = path.join(rulesDir, 'rules.md');

      if (!fs.existsSync(rulesDir)) {
        fs.mkdirSync(rulesDir, { recursive: true });
      }

      let rules = '';
      if (fs.existsSync(rulesPath)) {
        rules = fs.readFileSync(rulesPath, 'utf8');
      } else {
        rules = '# Sprint Forge — Learned Rules\n\n';
      }

      // Find next rule number
      const ruleNumbers = (rules.match(/\[RULE-(\d+)\]/g) || [])
        .map(r => parseInt(r.match(/\d+/)[0]));
      let nextNum = ruleNumbers.length > 0 ? Math.max(...ruleNumbers) + 1 : 1;

      learnings.forEach(l => {
        const date = new Date().toISOString().split('T')[0];
        const ruleEntry = `- [RULE-${String(nextNum).padStart(3, '0')}] ${l.rule} (${date})\n`;

        // Check if category section exists
        const categoryHeader = `## ${l.category}`;
        if (rules.includes(categoryHeader)) {
          rules = rules.replace(categoryHeader, `${categoryHeader}\n${ruleEntry}`);
        } else {
          rules += `\n${categoryHeader}\n${ruleEntry}`;
        }

        console.error(`[SprintForge] Captured: [RULE-${String(nextNum).padStart(3, '0')}] ${l.category}: ${l.rule}`);
        nextNum++;
      });

      fs.writeFileSync(rulesPath, rules);
    }
  } catch (e) {
    // Silently pass through on error
  }

  console.log(data);
});
