#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const userMessage = input.user_message || '';

    // Check for active sprint
    const kyroDir = path.join(process.cwd(), '.agents', 'kyro');
    if (fs.existsSync(kyroDir)) {
      const sprintsDir = path.join(kyroDir, 'sprints');
      if (fs.existsSync(sprintsDir)) {
        const sprints = fs.readdirSync(sprintsDir).filter(f => f.endsWith('.md')).sort();
        if (sprints.length > 0) {
          const latest = sprints[sprints.length - 1];
          const content = fs.readFileSync(path.join(sprintsDir, latest), 'utf8');

          if (/status:\s*in-progress/i.test(content)) {
            // Check if user message seems unrelated to sprint work
            const sprintKeywords = /sprint|task|phase|forge|debt|retro|status|roadmap/i;
            const codeKeywords = /fix|implement|add|update|refactor|test|debug/i;

            if (!sprintKeywords.test(userMessage) && !codeKeywords.test(userMessage)) {
              // Could be drift — gentle reminder
              if (userMessage.length > 50) {
                console.error('[Kyro] Reminder: Sprint in progress (' + latest + ')');
                console.error('[Kyro] Is this related to the current sprint task?');
              }
            }
          }
        }
      }
    }
  } catch (e) {
    // Silently pass through
  }

  console.log(data);
});
