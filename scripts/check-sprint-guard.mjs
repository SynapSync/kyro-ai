#!/usr/bin/env node
// Verifies the Claude-only PreToolUse defense in depth. Every Write/Edit of CLI-owned Kyro state
// must be blocked regardless of whether the proposed JSON happens to be valid.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const hook = resolve(repo, 'hooks/guard-sprint-close.mjs');
const root = mkdtempSync(join(tmpdir(), 'kyro-sprint-guard-'));

function decide(payload) {
  const result = spawnSync(process.execPath, [hook], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
  });
  if (result.status === 2) return { verdict: 'block', stderr: result.stderr };
  if (result.status === 0) return { verdict: 'allow', stderr: result.stderr };
  throw new Error('unexpected hook exit ' + result.status + ': ' + result.stderr);
}

function write(path) {
  return { tool_name: 'Write', tool_input: { file_path: path, content: '{}\n' } };
}

function edit(path) {
  return { tool_name: 'Edit', tool_input: { file_path: path, old_string: 'a', new_string: 'b' } };
}

const owned = [
  join(root, '.agents/kyro/project.json'),
  join(root, '.agents/kyro/local.json'),
  join(root, '.agents/kyro/scopes/demo/sprint.json'),
  join(root, '.agents/kyro/scopes/demo/archive/sprint-001-demo.json'),
  join(root, '.agents/kyro/scopes/demo/archive/sprint-001-demo.md'),
  join(root, '.agents/kyro/scopes/demo/archive/sprint-001-demo.checkpoint.json'),
];

const cases = owned.flatMap((path) => [
  ['block', 'Write ' + path, write(path)],
  ['block', 'Edit ' + path, edit(path)],
]);
cases.push(
  ['allow', 'scope finding remains agent-authored evidence', write(join(root, '.agents/kyro/scopes/demo/findings/01-audit.md'))],
  ['allow', 'unrelated sprint.json', write(join(root, 'other/sprint.json'))],
  ['allow', 'unrelated project.json', write(join(root, 'other/project.json'))],
  ['allow', 'Read is not a mutation', { tool_name: 'Read', tool_input: { file_path: owned[0] } }],
  ['allow', 'malformed payload fails open', {}],
);

const failures = [];
for (const [expected, label, payload] of cases) {
  const observed = decide(payload);
  if (observed.verdict !== expected) failures.push('expected ' + expected + ', got ' + observed.verdict + ': ' + label);
}

const blocked = decide(write(owned[2]));
for (const needle of ['CLI-owned state', 'kyro --version', 'npx kyro-ai@latest sync', 'defense in depth']) {
  if (!blocked.stderr.includes(needle)) failures.push('block message should mention ' + JSON.stringify(needle));
}

rmSync(root, { recursive: true, force: true });

if (failures.length > 0) {
  console.error('check:sprint-guard — ' + failures.length + ' case(s) failed:\n' + failures.join('\n'));
  process.exit(1);
}

console.log('check:sprint-guard — ' + cases.length + ' CLI-owned state guard cases passed');
