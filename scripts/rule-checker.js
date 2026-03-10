#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  // Rule checking is primarily done at the agent level via SKILL.md instructions.
  // This hook provides a lightweight pre-check for common violations.

  try {
    const rulesPath = path.join(process.cwd(), '.agents', 'kyro', 'rules.md');
    if (fs.existsSync(rulesPath)) {
      const rules = fs.readFileSync(rulesPath, 'utf8');
      const input = JSON.parse(data);
      const userMessage = (input.user_message || '').toLowerCase();

      // Check for estimation-related rules when user mentions estimates
      if (/estim|time|how long|hours|days/i.test(userMessage)) {
        const estimationRules = rules.match(/## Estimation[\s\S]*?(?=##|$)/);
        if (estimationRules) {
          const ruleLines = estimationRules[0].match(/\[RULE-\d+\].*/g) || [];
          if (ruleLines.length > 0) {
            console.error('[Kyro] Estimation rules to consider:');
            ruleLines.slice(0, 3).forEach(r => console.error('  ' + r.trim()));
          }
        }
      }
    }
  } catch (e) {
    // Silently pass through
  }

  console.log(data);
});
