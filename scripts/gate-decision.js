#!/usr/bin/env node

const fs = require('node:fs');
const { appendAudit, loadState, saveState, statePath } = require('./lib/state-store');
const { fail, pass, readJson } = require('./lib/workflow-utils');

const [scope, gate] = process.argv.slice(2);

if (!scope || !gate) {
  throw new Error('Usage: node scripts/gate-decision.js <scope> <gate>');
}

const config = readJson('config.json');
const gates = config.gates || {};
const mode = gates.mode || 'strict';
const alwaysGate = new Set(gates.always_gate || []);
const knownGate = Boolean(gates.taxonomy?.[gate]);

if (!knownGate) {
  fail('Unknown gate.', [{ gate, known: Object.keys(gates.taxonomy || {}) }]);
}

const required = mode === 'strict' || alwaysGate.has(gate) || (mode === 'standard' && gate !== 'implementation');
const decision = required ? 'ask' : 'auto';
const details = { gate, mode, decision, required };

if (!required && fs.existsSync(statePath(scope))) {
  const state = loadState(scope);
  appendAudit(state, 'gate.auto_approved', details);
  saveState(scope, state);
}

pass('Gate decision resolved.', [details]);
