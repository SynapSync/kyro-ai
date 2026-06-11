#!/usr/bin/env node

const { fail, pass, readJson } = require('./lib/workflow-utils');

const [taskId] = process.argv.slice(2);
const config = readJson('config.json');

if (!taskId) {
  throw new Error('Usage: node scripts/worktree-task.js <task-id>');
}

if (!config.parallelism?.worktree_tasks) {
  fail('Worktree task execution is disabled.', [
    {
      taskId,
      enableWith: 'config.parallelism.worktree_tasks = true'
    }
  ]);
}

pass('Worktree task execution is enabled for this task.', [
  {
    taskId,
    requiredSafeguards: [
      'Task must be marked independent in the sprint file.',
      'Create one worktree per task.',
      'Run deterministic checks before merge.',
      'Stop on merge conflict and return to sequential execution.'
    ]
  }
]);
