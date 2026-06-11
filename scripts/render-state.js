#!/usr/bin/env node

const { loadState } = require('./lib/state-store');
const { pass } = require('./lib/workflow-utils');

const [scope, view = 'summary'] = process.argv.slice(2);

if (!scope) {
  throw new Error('Usage: node scripts/render-state.js <scope> [summary|debt|metrics]');
}

const state = loadState(scope);

function renderDebt() {
  const lines = [
    '| # | Item | Origin | Sprint Target | Status | Resolved In |',
    '|---|------|--------|--------------|--------|-------------|'
  ];

  for (const item of state.debt) {
    const label = item.aged ? `[AGED] ${item.item}` : item.item;
    lines.push(`| ${item.id} | ${label} | ${item.origin} | ${item.sprint_target} | ${item.status} | ${item.resolved_in || '—'} |`);
  }

  return lines.join('\n');
}

function renderMetrics() {
  const completed = state.sprints.filter((sprint) => sprint.status === 'completed').length;
  const openDebt = state.debt.filter((item) => item.status !== 'resolved').length;
  const resolvedDebt = state.debt.filter((item) => item.status === 'resolved').length;

  return [
    '| Metric | Value |',
    '|--------|-------|',
    `| Sprints completed | ${completed} |`,
    `| Open debt | ${openDebt} |`,
    `| Resolved debt | ${resolvedDebt} |`
  ].join('\n');
}

const rendered = view === 'debt'
  ? renderDebt()
  : view === 'metrics'
    ? renderMetrics()
    : `${renderMetrics()}\n\n${renderDebt()}`;

pass('State rendered.', [
  {
    scope,
    view,
    rendered
  }
]);
