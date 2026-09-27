import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = mkdtempSync(join(tmpdir(), 'kyro-work-isolation-'));
const cli = resolve('dist/cli.js');
const run = (...args) => spawnSync(process.execPath, [cli, 'work', ...args], { cwd: root, encoding: 'utf8' });
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
try {
  mkdirSync(join(root, '.agents/kyro/scopes/forge-existing'), { recursive: true });
  writeFileSync(join(root, '.agents/kyro/project.json'), '{"forge":"project"}\n');
  writeFileSync(join(root, '.agents/kyro/local.json'), '{"forge":"local"}\n');
  writeFileSync(join(root, '.agents/kyro/scopes/forge-existing/sprint.json'), '{"forge":"sprint"}\n');
  writeFileSync(join(root, 'brief.md'), '# Isolated Work\n\nKeep Forge project state unchanged across Work operations.\n');
  const protectedFiles = ['.agents/kyro/project.json', '.agents/kyro/local.json', '.agents/kyro/scopes/forge-existing/sprint.json'];
  const before = protectedFiles.map((file) => digest(join(root, file)));
  assert.equal(run('create', '--id', 'isolated-work', '--from', 'brief.md', '--json').status, 0);
  assert.equal(run('status', '--work', 'isolated-work', '--json').status, 0);
  assert.equal(run('context-pack', '--work', 'isolated-work', '--json').status, 0);
  assert.deepEqual(protectedFiles.map((file) => digest(join(root, file))), before, 'Work commands must not mutate Forge layers');
  // T4.1: rejected creates publish no partial Work and preserve Forge bytes.
  writeFileSync(join(root, 'malformed.md'), Buffer.from([0xff]));
  assert.notEqual(run('create', '--id', 'rejected-work', '--from', 'malformed.md', '--json').status, 0);
  assert(!existsSync(join(root, '.agents/kyro/work/rejected-work')), 'a rejected create must not publish a partial Work directory');
  assert.notEqual(run('create', '--id', 'missing-work', '--from', 'no-such-brief.md', '--json').status, 0);
  assert(!existsSync(join(root, '.agents/kyro/work/missing-work')), 'a missing source must not publish a partial Work directory');
  assert.deepEqual(protectedFiles.map((file) => digest(join(root, file))), before, 'Rejected Work creates must not mutate Forge layers');
  // T4.6: promotion publishes a new scope while unrelated Forge layers stay byte-identical.
  writeFileSync(join(root, 'tasks.json'), JSON.stringify({ tasks: [{ id: 'W1', title: 'Isolated task', description: 'Transfer one task.', context: '', filesToTouch: [], acceptanceCriteria: ['Output is transferred.'], dependsOn: [] }] }));
  assert.equal(run('plan', '--work', 'isolated-work', '--from', 'tasks.json', '--expect-revision', '1', '--json').status, 0);
  const promoted = run('promote', '--work', 'isolated-work', '--to-scope', 'isolated-target', '--expect-revision', '2', '--by', 'isolation-owner', '--yes', '--json');
  assert.equal(promoted.status, 0, promoted.stderr || promoted.stdout);
  assert(existsSync(join(root, '.agents/kyro/scopes/isolated-target/sprint.json')), 'promotion must publish its own new scope');
  assert(existsSync(join(root, '.agents/kyro/scopes/isolated-target/promotion-source.json')), 'promotion must publish its reciprocal link');
  assert(!existsSync(join(root, '.agents/kyro/work/isolated-work/.pending-promotion.json')), 'a successful promotion must clear its intent');
  assert.deepEqual(protectedFiles.map((file) => digest(join(root, file))), before, 'Promotion must not mutate unrelated Forge layers');
  const tracked = spawnSync('git', ['check-ignore', '.agents/kyro/work/organic-work-smoke/work.json'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(tracked.status, 1, 'Work artifacts must not be ignored in this repository');
  console.log('Work Forge-isolation and Git-trackability fixtures passed.');
} finally { rmSync(root, { recursive: true, force: true }); }
