#!/usr/bin/env node

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const taskId = input.task_id || 'unknown';

    console.error(`[SprintForge] Task completed: ${taskId}`);
    console.error('[SprintForge] Running post-task quality checklist:');
    console.error('  □ Tests passing?');
    console.error('  □ No debug statements?');
    console.error('  □ No hardcoded secrets?');
    console.error('  □ Debt table updated?');
    console.error('[SprintForge] Use reviewer agent for full validation.');
  } catch (e) {
    console.error('[SprintForge] Task completed. Run quality checks.');
  }

  console.log(data);
});
