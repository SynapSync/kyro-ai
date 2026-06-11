#!/usr/bin/env node

const path = require('node:path');
const { listFilesRecursively, pass, readText, resolveRoot } = require('./lib/workflow-utils');

const scope = process.argv[2];

if (!scope) {
  throw new Error('Usage: node scripts/metrics-aggregate.js <scope>');
}

const sprintDir = resolveRoot('.agents', 'sprint-forge', scope, 'sprints');
const sprintFiles = listFilesRecursively(sprintDir).filter((file) => path.basename(file).endsWith('.md'));

function parseSprintMetrics(file) {
  const relativePath = path.relative(resolveRoot(), file);
  const content = readText(relativePath);
  const frontmatterSprint = content.match(/^sprint:\s*(\d+)/m);
  const progress = content.match(/^progress:\s*(\d+)/m);
  const estimated = [...content.matchAll(/\|\s*[^|\n]+\s*\|\s*(\d+(?:\.\d+)?)\s*(?:SP)?\s*\|/gi)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  const actualMatches = [...content.matchAll(/actual:\s*(\d+(?:\.\d+)?)\s*(?:SP|h)?/gi)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);

  return {
    file: relativePath,
    sprint: frontmatterSprint ? Number(frontmatterSprint[1]) : null,
    progress: progress ? Number(progress[1]) : null,
    estimatedTotal: estimated.reduce((total, value) => total + value, 0),
    actualTotal: actualMatches.reduce((total, value) => total + value, 0)
  };
}

const sprints = sprintFiles.map(parseSprintMetrics);
const estimatedTotal = sprints.reduce((total, sprint) => total + sprint.estimatedTotal, 0);
const actualTotal = sprints.reduce((total, sprint) => total + sprint.actualTotal, 0);

pass('Metrics aggregation completed.', [
  {
    scope,
    sprintCount: sprints.length,
    estimatedTotal,
    actualTotal,
    sprints
  }
]);
