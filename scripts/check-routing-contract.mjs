#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const routingDist = resolve(repo, 'dist/cli/routing.js');
const orchestratorPath = resolve(repo, 'agents/orchestrator.md');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!existsSync(routingDist)) fail('dist/cli/routing.js missing. Run npm run build first.');

const { ROUTING_TABLE, validateRoutingTableModes } = await import(`file://${routingDist}`);
const missingModes = validateRoutingTableModes();
if (missingModes.length > 0) fail(`routing table references missing mode files: ${missingModes.join(', ')}`);

const text = readFileSync(orchestratorPath, 'utf-8');
const markdownRoutes = new Map();
for (const line of text.split('\n')) {
  if (!line.startsWith('| `')) continue;
  const cells = line.split('|').map((cell) => cell.trim());
  const actionCell = cells[1] ?? '';
  const loadCell = cells[2] ?? '';
  const actions = [...actionCell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const modes = [...loadCell.matchAll(/assets\/modes\/([A-Za-z0-9_.-]+\.md)/g)].map((match) => basename(match[1]));
  for (const action of actions) {
    if (action in ROUTING_TABLE) markdownRoutes.set(action, modes);
  }
}

const failures = [];
for (const [nextAction, route] of Object.entries(ROUTING_TABLE)) {
  const actual = markdownRoutes.get(nextAction);
  if (!actual) {
    failures.push(`${nextAction}: missing from agents/orchestrator.md routing table`);
    continue;
  }
  const expectedText = route.modes.join(',');
  const actualText = actual.join(',');
  if (expectedText !== actualText) failures.push(`${nextAction}: markdown=${actualText || '(none)'} code=${expectedText}`);
}

if (failures.length > 0) fail(`routing contract drift:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
console.log('check:routing — orchestrator routing table matches code contract');
