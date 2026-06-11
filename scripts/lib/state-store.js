const fs = require('node:fs');
const path = require('node:path');
const { resolveRoot } = require('./workflow-utils');

function statePath(scope) {
  return resolveRoot('.agents', 'sprint-forge', scope, 'state.json');
}

function now() {
  return new Date().toISOString();
}

function createEmptyState(scope) {
  const timestamp = now();

  return {
    schema_version: 1,
    scope,
    created_at: timestamp,
    updated_at: timestamp,
    sprints: [],
    debt: [],
    metrics: {},
    audit: [
      {
        at: timestamp,
        action: 'state.created',
        details: { scope }
      }
    ]
  };
}

function loadState(scope) {
  return JSON.parse(fs.readFileSync(statePath(scope), 'utf8'));
}

function saveState(scope, state) {
  state.updated_at = now();
  fs.mkdirSync(path.dirname(statePath(scope)), { recursive: true });
  fs.writeFileSync(statePath(scope), `${JSON.stringify(state, null, 2)}\n`);
}

function appendAudit(state, action, details = {}) {
  state.audit.push({
    at: now(),
    action,
    details
  });
}

function validateDebtInvariants(state) {
  const seen = new Set();
  const errors = [];

  for (const item of state.debt) {
    if (seen.has(item.id)) {
      errors.push({ id: item.id, error: 'duplicate debt id' });
    }

    seen.add(item.id);

    if (item.status === 'resolved' && !item.resolved_in) {
      errors.push({ id: item.id, error: 'resolved debt must include resolved_in' });
    }

    if (item.status !== 'resolved' && item.resolved_in) {
      errors.push({ id: item.id, error: 'unresolved debt cannot include resolved_in' });
    }
  }

  const ids = [...seen].sort((a, b) => a - b);

  ids.forEach((id, index) => {
    if (id !== index + 1) {
      errors.push({ id, error: `debt id sequence must be append-only; expected ${index + 1}` });
    }
  });

  return errors;
}

module.exports = {
  appendAudit,
  createEmptyState,
  loadState,
  saveState,
  statePath,
  validateDebtInvariants
};
