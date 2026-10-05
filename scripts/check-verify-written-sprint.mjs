#!/usr/bin/env node
// Verifies verifyWrittenSprint: the shared post-write re-parse of a scope's sprint.json.
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectError(fn, code, includes, remedy) {
  try {
    fn();
  } catch (error) {
    assert(error.code === code, `expected ${code}, got ${error.code}: ${error.message}`);
    for (const text of includes) assert(error.message.includes(text), `message should include "${text}": ${error.message}`);
    if (remedy) assert(error.remedy === remedy, `expected remedy "${remedy}", got "${error.remedy}"`);
    return;
  }
  throw new Error(`expected ${code} but nothing was thrown`);
}

const root = mkdtempSync(join(tmpdir(), 'kyro-verify-written-'));
const previous = process.cwd();
try {
  cpSync(resolve(repo, 'fixtures/evals/route-review-task/state'), root, { recursive: true });
  process.chdir(root); // WORKSPACE_ROOT is fixed at module load, so require after chdir
  const { verifyWrittenSprint } = require(resolve(repo, 'dist/cli/artifacts/load-sprint.js'));
  const path = '.agents/kyro/scopes/demo/sprint.json';
  const original = readFileSync(path, 'utf-8');

  const sprint = verifyWrittenSprint('demo', 'test op');
  assert(sprint && sprint.scope === JSON.parse(original).scope && sprint.handoff, 'valid file should return the parsed sprint');

  unlinkSync(path);
  expectError(() => verifyWrittenSprint('demo', 'test op'), 'INVALID_JSON', ['test op wrote sprint.json but re-parse failed (missing)'], 'Restore from an archive snapshot.');

  writeFileSync(path, '{not json');
  expectError(() => verifyWrittenSprint('demo', 'test op'), 'INVALID_JSON', ['test op wrote sprint.json but re-parse failed (']);

  const drifted = JSON.parse(original);
  delete drifted.handoff;
  writeFileSync(path, JSON.stringify(drifted, null, 2));
  expectError(() => verifyWrittenSprint('demo', 'test op'), 'INVALID_SPRINT_SHAPE', ['test op wrote sprint.json but it failed validation — ', 'handoff'], 'Restore from an archive snapshot.');
  expectError(() => verifyWrittenSprint('demo', 'test op', { remedy: 'Use the snapshot.' }), 'INVALID_SPRINT_SHAPE', ['handoff'], 'Use the snapshot.');
} finally {
  process.chdir(previous);
  rmSync(root, { recursive: true, force: true });
}

console.log('verifyWrittenSprint checks passed.');
