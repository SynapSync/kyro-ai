#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const roots = ['agents', 'commands', 'internal/skills', 'providers'];
const projectedInvocation = 'node /tmp/kyro-runtime/dist/cli.js';

const forbidden = [
  { label: 'manual-write fallback', pattern: /(?:fallback(?: only)?\s*:[^\n]*(?:hand[- ]write|Artifact Write Contract)|authorizes?[^\n]*hand[- ]write fallback)/i },
  { label: 'agent Artifact Write Contract mutation', pattern: /(?:mutate|write|update)[^\n]{0,120}(?:via|using|follows?) (?:the )?Artifact Write Contract/i },
  { label: 'direct managed JSON safe-write', pattern: /(?:performs?|make)[^\n]{0,80}(?:safe-write|direct write)[^\n]{0,80}(?:sprint\.json|project\.json|local\.json)/i },
  { label: 'manual managed-history write', pattern: /(?:fallback|agent)[^\n]{0,80}(?:write|edit)[^\n]{0,80}(?:checkpoint|archive\/)/i },
];

function markdownFiles(root) {
  const absolute = resolve(repo, root);
  const result = [];
  for (const entry of readdirSync(absolute)) {
    const path = resolve(absolute, entry);
    if (statSync(path).isDirectory()) result.push(...markdownFiles(relative(repo, path)));
    else if (path.endsWith('.md')) result.push(path);
  }
  return result;
}

function violations(label, content) {
  return forbidden
    .filter(({ pattern }) => pattern.test(content))
    .map(({ label: violation }) => label + ': ' + violation);
}

const failures = [];
const files = roots.flatMap(markdownFiles);
for (const path of files) {
  const name = relative(repo, path);
  const canonical = readFileSync(path, 'utf-8');
  failures.push(...violations('canonical ' + name, canonical));
  const projected = canonical.replaceAll('{{KYRO_CLI}}', projectedInvocation);
  failures.push(...violations('projected ' + name, projected));
}

for (const required of ['agents/orchestrator.md', 'internal/skills/sprint-forge/SKILL.md']) {
  const content = readFileSync(resolve(repo, required), 'utf-8');
  for (const phrase of ['observed', 'without mutating', 'npx kyro-ai@latest sync --scope workspace --yes']) {
    if (!content.includes(phrase)) failures.push(required + ': missing fail-closed startup phrase ' + JSON.stringify(phrase));
  }
}

if (failures.length > 0) {
  console.error('check:managed-write-contract — forbidden managed-state guidance found:\n' + failures.join('\n'));
  process.exit(1);
}

console.log('check:managed-write-contract — ' + files.length + ' canonical assets and projections are CLI-owned');
