#!/usr/bin/env node

const path = require('node:path');
const { listFilesRecursively, pass, resolveRoot } = require('./lib/workflow-utils');

const scope = process.argv[2];

if (!scope) {
  throw new Error('Usage: node scripts/sprint-number.js <scope>');
}

const sprintDir = resolveRoot('.agents', 'sprint-forge', scope, 'sprints');
const sprintNumbers = listFilesRecursively(sprintDir)
  .map((file) => path.basename(file).match(/^SPRINT-(\d+)/))
  .filter(Boolean)
  .map((match) => Number(match[1]));

const latest = sprintNumbers.length > 0 ? Math.max(...sprintNumbers) : -1;
const next = latest + 1;

pass('Sprint number resolved.', [
  {
    scope,
    latest,
    next
  }
]);
