import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'kyro-work-disposition-'));
const cli = resolve('dist/cli.js');
try {
  const write = (path, value) => { const target = join(root, path); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, value); };
  const run = (...args) => spawnSync(process.execPath, [cli, 'work', ...args, '--json'], { cwd: root, encoding: 'utf8' });
  const ok = (...args) => { const result = run(...args); assert.equal(result.status, 0, result.stdout || result.stderr); return JSON.parse(result.stdout).data; };
  const bad = (pattern, ...args) => { const result = run(...args); assert.notEqual(result.status, 0); assert.match(JSON.parse(result.stdout).error.message, pattern); };
  const workPath = join(root, '.agents/kyro/work/disposition/work.json');
  const common = ['--work', 'disposition'];
  const dispose = (task, kind, revision, extra = []) => ['dispose', ...common, '--task', task, '--kind', kind, '--reason', 'No longer part of this plan.', '--by', 'fixture-owner', '--expect-revision', String(revision), ...extra];
  write('brief.md', '# Disposition fixture\n\nVerify explicit terminal task disposition.\n');
  write('.agents/kyro/project.json', '{"unchanged":true}\n');
  const forgeBefore = readFileSync(join(root, '.agents/kyro/project.json'));
  write('plan.json', JSON.stringify({ tasks: [
    { id: 'W1', title: 'Original', description: 'Original task.', context: '', filesToTouch: [], acceptanceCriteria: ['Original is done.'], dependsOn: [] },
    { id: 'W2', title: 'Dependent', description: 'Depends on W1.', context: '', filesToTouch: [], acceptanceCriteria: ['Dependency is met.'], dependsOn: ['W1'] },
    { id: 'W3', title: 'Replacement', description: 'Independent replacement.', context: '', filesToTouch: [], acceptanceCriteria: ['Replacement is done.'], dependsOn: [] },
  ] }));
  ok('create', '--id', 'disposition', '--from', 'brief.md');
  ok('plan', ...common, '--from', 'plan.json', '--expect-revision', '1');
  const original = readFileSync(workPath);
  const preview = ok(...dispose('W1', 'superseded', 2, ['--replacement-task', 'W3', '--dry-run']));
  assert.equal(preview.status, 'superseded');
  assert.deepEqual(readFileSync(workPath), original);
  bad(/replacement/i, ...dispose('W1', 'superseded', 2));
  bad(/cannot have a replacement/i, ...dispose('W1', 'cancelled', 2, ['--replacement-task', 'W3']));
  bad(/different existing/i, ...dispose('W1', 'superseded', 2, ['--replacement-task', 'W9']));
  bad(/does not exist/i, ...dispose('W9', 'cancelled', 2));
  assert.deepEqual(readFileSync(workPath), original);
  ok(...dispose('W1', 'superseded', 2, ['--replacement-task', 'W3']));
  const after = JSON.parse(readFileSync(workPath, 'utf8'));
  assert.equal(after.tasks[0].status, 'superseded');
  assert.equal(after.tasks[0].disposition.replacementTaskId, 'W3');
  assert.equal(after.tasks[1].status, 'pending');
  assert.deepEqual(after.tasks[1].dependsOn, ['W1']);
  assert.equal(after.handoff.nextTaskId, 'W3');
  assert(after.activity.some((event) => event.event === 'task_disposed' && event.taskId === 'W1'));
  bad(/revision .* does not match expected/i, ...dispose('W2', 'cancelled', 2));
  bad(/dependency W1 is superseded/i, 'start', ...common, '--task', 'W2', '--expect-revision', '3');
  ok(...dispose('W3', 'cancelled', 3));
  const blocked = ok('status', ...common);
  assert.equal(blocked.nextAction, 'resolve_blocker');
  assert.equal(blocked.nextTaskId, 'W2');
  assert.equal(blocked.tasks.filter((task) => task.status === 'verified').length, 0);
  assert.equal(blocked.tasks.filter((task) => ['cancelled', 'superseded'].includes(task.status)).length, 2);
  assert.deepEqual(readFileSync(join(root, '.agents/kyro/project.json')), forgeBefore);

  write('conflict-plan.json', JSON.stringify({ tasks: [
    { id: 'W1', title: 'Original', description: 'Original task.', context: '', filesToTouch: [], acceptanceCriteria: ['Original is done.'], dependsOn: [] },
    { id: 'W2', title: 'Replacement', description: 'Depends on original.', context: '', filesToTouch: [], acceptanceCriteria: ['Replacement is done.'], dependsOn: ['W1'] },
  ] }));
  ok('create', '--id', 'conflict', '--from', 'brief.md');
  ok('plan', '--work', 'conflict', '--from', 'conflict-plan.json', '--expect-revision', '1');
  const conflictPath = join(root, '.agents/kyro/work/conflict/work.json');
  const conflictBefore = readFileSync(conflictPath);
  bad(/depends on disposed task/i, 'dispose', '--work', 'conflict', '--task', 'W1', '--kind', 'superseded', '--replacement-task', 'W2', '--reason', 'Replace it.', '--by', 'fixture-owner', '--expect-revision', '2');
  assert.deepEqual(readFileSync(conflictPath), conflictBefore);
  console.log('Work disposition, dependency, preview, and Forge isolation fixtures passed.');
} finally { rmSync(root, { recursive: true, force: true }); }
