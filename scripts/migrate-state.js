#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { appendAudit, createEmptyState, saveState, statePath } = require('./lib/state-store');
const { listFilesRecursively, pass, readText, resolveRoot } = require('./lib/workflow-utils');

const [scope, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');

if (!scope) {
  throw new Error('Usage: node scripts/migrate-state.js <scope> [--dry-run]');
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
    .map((line) => line.split('|').map((cell) => cell.trim()).filter(Boolean))
    .map((cells) => ({
      id: Number(cells[0]),
      item: cells[1],
      origin: cells[2],
      sprint_target: cells[3],
      status: cells[4],
      resolved_in: cells[5] === '—' ? null : cells[5],
      created_in: null,
      aged: false
    }));
}

function extractTasks(content) {
  return [...content.matchAll(/- \[[ x!~>-]\]\s+\*\*([^*]+)\*\*:\s+(.+)/g)].map((match) => ({
    id: match[1].trim(),
    description: match[2].trim(),
    status: match[0].startsWith('- [x]') ? 'completed' : 'pending'
  }));
}

const sprintDir = resolveRoot('.agents', 'sprint-forge', scope, 'sprints');
const sprintFiles = listFilesRecursively(sprintDir)
  .filter((file) => path.basename(file).endsWith('.md'))
  .sort();
const state = createEmptyState(scope);

for (const file of sprintFiles) {
  const relativePath = path.relative(resolveRoot(), file);
  const content = readText(relativePath);
  const sprintNumber = Number(content.match(/^sprint:\s*(\d+)/m)?.[1]);
  const slug = path.basename(file).replace(/^SPRINT-\d+-/, '').replace(/\.md$/, '');
  const status = content.match(/^status:\s*"?(.*?)"?$/m)?.[1] || 'pending';

  if (Number.isFinite(sprintNumber)) {
    state.sprints.push({
      number: sprintNumber,
      slug,
      status: status === 'completed' ? 'completed' : 'pending',
      version_target: content.match(/> Version Target:\s*(.+)/)?.[1]?.trim(),
      tasks: extractTasks(content)
    });
  }

  for (const debt of extractDebtRows(content)) {
    if (!state.debt.some((item) => item.id === debt.id)) {
      state.debt.push(debt);
    }
  }
}

appendAudit(state, 'state.migrated', { sprint_files: sprintFiles.length, dry_run: dryRun });

if (!dryRun) {
  saveState(scope, state);
}

pass(dryRun ? 'State migration dry run completed.' : 'State migration completed.', [
  {
    scope,
    path: statePath(scope),
    sprintCount: state.sprints.length,
    debtCount: state.debt.length,
    dryRun
  }
]);
