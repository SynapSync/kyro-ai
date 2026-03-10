#!/usr/bin/env node
const { findActiveProject, findLatestSprint } = require('./lib/paths');

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const userMessage = input.user_message || '';

    const activeProject = findActiveProject();
    if (activeProject) {
      const latest = findLatestSprint(activeProject.sprintsDir);
      if (latest && /status:\s*["']?active["']?/i.test(latest.content)) {
        const sprintKeywords = /sprint|task|phase|forge|debt|retro|status|roadmap/i;
        const codeKeywords = /fix|implement|add|update|refactor|test|debug/i;

        if (!sprintKeywords.test(userMessage) && !codeKeywords.test(userMessage)) {
          if (userMessage.length > 50) {
            console.error('[Kyro] Reminder: Sprint in progress (' + latest.file + ')');
            console.error('[Kyro] Is this related to the current sprint task?');
          }
        }
      }
    }
  } catch (e) {
    // Silently pass through
  }

  console.log(data);
});
