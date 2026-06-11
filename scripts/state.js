#!/usr/bin/env node

const fs = require('node:fs');
const {
  appendAudit,
  createEmptyState,
  loadState,
  saveState,
  statePath,
  validateDebtInvariants
} = require('./lib/state-store');
const { fail, pass } = require('./lib/workflow-utils');

const [command, scope, ...args] = process.argv.slice(2);

function requireScope() {
  if (!scope) {
    throw new Error('Usage: node scripts/state.js <command> <scope> [...args]');
  }
}

function parseOptions(values) {
  const options = {};

  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];

    if (!key || !key.startsWith('--')) {
      throw new Error(`Expected option flag, received ${key || '<empty>'}.`);
    }

    options[key.slice(2)] = value;
  }

  return options;
}

function nextDebtId(state) {
  return state.debt.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

requireScope();

if (command === 'init') {
  if (fs.existsSync(statePath(scope))) {
    pass('State already exists.', [{ scope, path: statePath(scope) }]);
    process.exit(0);
  }

  const state = createEmptyState(scope);
  saveState(scope, state);
  pass('State initialized.', [{ scope, path: statePath(scope) }]);
  process.exit(0);
}

const state = loadState(scope);

if (command === 'add-debt') {
  const options = parseOptions(args);
  const item = {
    id: nextDebtId(state),
    item: options.item,
    origin: options.origin,
    sprint_target: options.target,
    status: 'open',
    resolved_in: null,
    created_in: options.created_in ? Number(options.created_in) : null,
    aged: false
  };

  if (!item.item || !item.origin || !item.sprint_target) {
    throw new Error('add-debt requires --item, --origin, and --target.');
  }

  state.debt.push(item);
  appendAudit(state, 'debt.added', { id: item.id });
  saveState(scope, state);
  pass('Debt item added.', [item]);
} else if (command === 'resolve-debt') {
  const options = parseOptions(args);
  const id = Number(options.id);
  const debt = state.debt.find((item) => item.id === id);

  if (!debt) {
    fail('Debt item not found.', [{ id }]);
  }

  debt.status = 'resolved';
  debt.resolved_in = options.sprint;
  appendAudit(state, 'debt.resolved', { id, sprint: options.sprint });
  saveState(scope, state);
  pass('Debt item resolved.', [debt]);
} else if (command === 'set-task') {
  const options = parseOptions(args);
  const sprintNumber = Number(options.sprint);
  const sprint = state.sprints.find((item) => item.number === sprintNumber);

  if (!sprint) {
    fail('Sprint not found.', [{ sprint: sprintNumber }]);
  }

  const task = sprint.tasks.find((item) => item.id === options.task);

  if (!task) {
    fail('Task not found.', [{ sprint: sprintNumber, task: options.task }]);
  }

  task.status = options.status;
  appendAudit(state, 'task.status_changed', { sprint: sprintNumber, task: options.task, status: options.status });
  saveState(scope, state);
  pass('Task status updated.', [task]);
} else if (command === 'record-actual') {
  const options = parseOptions(args);
  const sprintNumber = Number(options.sprint);
  const sprint = state.sprints.find((item) => item.number === sprintNumber);

  if (!sprint) {
    fail('Sprint not found.', [{ sprint: sprintNumber }]);
  }

  const task = sprint.tasks.find((item) => item.id === options.task);

  if (!task) {
    fail('Task not found.', [{ sprint: sprintNumber, task: options.task }]);
  }

  task.actual_sp = Number(options.actual);
  appendAudit(state, 'task.actual_recorded', { sprint: sprintNumber, task: options.task, actual_sp: task.actual_sp });
  saveState(scope, state);
  pass('Task actual recorded.', [task]);
} else if (command === 'validate') {
  const errors = validateDebtInvariants(state);

  if (errors.length > 0) {
    fail('State validation failed.', errors);
  }

  pass('State validation passed.', [{ scope }]);
} else {
  throw new Error(`Unknown state command: ${command}`);
}
