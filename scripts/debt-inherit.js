#!/usr/bin/env node

const fs = require('node:fs');
const { loadState, validateDebtInvariants } = require('./lib/state-store');
const { fail, pass, resolveRoot } = require('./lib/workflow-utils');

const [previousSprint, currentSprint] = process.argv.slice(2);

if (previousSprint === '--state') {
  const scope = currentSprint;

  if (!scope) {
    throw new Error('Usage: node scripts/debt-inherit.js --state <scope>');
  }

  const state = loadState(scope);
  const errors = validateDebtInvariants(state);

  if (errors.length > 0) {
    fail('State debt invariant check failed.', errors);
  }

  pass('State debt invariant check passed.', [
    {
      scope,
      debtRows: state.debt.length
    }
  ]);
  process.exit(0);
}

if (!previousSprint || !currentSprint) {
  throw new Error('Usage: node scripts/debt-inherit.js <previous-sprint-file> <current-sprint-file> OR node scripts/debt-inherit.js --state <scope>');
}

function readSprint(relativePath) {
  return fs.readFileSync(resolveRoot(relativePath), 'utf8');
}

function extractDebtRows(content) {
  const section = content.match(/## Accumulated Technical Debt\n([\s\S]*?)(\n---|\n## )/);

  if (!section) {
    return [];
  }

  return section[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => {
      const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);

      return {
        id: cells[0],
        item: cells[1] || '',
        row: line
      };
    });
}

const previousRows = extractDebtRows(readSprint(previousSprint));
const currentRows = extractDebtRows(readSprint(currentSprint));
const currentById = new Map(currentRows.map((row) => [row.id, row]));

const missingRows = previousRows.filter((row) => !currentById.has(row.id));

if (missingRows.length > 0) {
  fail('Debt inheritance failed. Current sprint is missing inherited debt rows.', missingRows);
}

pass('Debt inheritance check passed.', [
  {
    previousSprint,
    currentSprint,
    inheritedRows: previousRows.length,
    currentRows: currentRows.length
  }
]);
