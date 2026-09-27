import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('dist/cli.js');
const root = mkdtempSync(join(tmpdir(), 'kyro-work-execution-'));
try {
  writeFileSync(join(root, 'brief.md'), '# Execution fixture\n\nValidate dependency-safe Work execution and deterministic read models.\n');
  const tasks = [
    { id: 'W1', title: 'Prerequisite', description: 'Start as an independent prerequisite task.', context: '', filesToTouch: ['src/one.ts'], acceptanceCriteria: ['Prerequisite is ready.'], dependsOn: [] },
    { id: 'W2', title: 'Independent', description: 'Remain independently runnable while W1 is blocked.', context: '', filesToTouch: ['src/two.ts'], acceptanceCriteria: ['Independent work can progress.'], dependsOn: [] },
    { id: 'W3', title: 'Dependent', description: 'Wait for verified W1 before execution.', context: '', filesToTouch: ['src/three.ts'], acceptanceCriteria: ['Dependent work waits for W1.'], dependsOn: ['W1'] },
  ];
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  const data = (result) => { assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout).data; };
  const mutation = (verb, revision, ...args) => run('work', verb, '--work', 'execution-fixture', '--task', args.shift(), '--expect-revision', String(revision), ...args, '--json');
  data(run('work', 'create', '--id', 'execution-fixture', '--from', 'brief.md', '--json'));
  const draftPack = data(run('work', 'context-pack', '--work', 'execution-fixture', '--json'));
  assert.match(draftPack.recipes[1], /work plan .*--expect-revision 1/);
  writeFileSync(join(root, 'proposal.json'), JSON.stringify({ tasks }));
  data(run('work', 'plan', '--work', 'execution-fixture', '--from', 'proposal.json', '--expect-revision', '1', '--json'));

  const blocked = data(mutation('block', 2, 'W1', '--reason', 'Required input is temporarily unavailable.'));
  assert.equal(blocked.revision, 3);
  assert.equal(blocked.handoff.nextAction, 'execute_task');
  assert.equal(blocked.handoff.nextTaskId, 'W2', 'independent W2 must remain runnable while W1 is blocked');
  const blockedStatus = data(run('work', 'status', '--work', 'execution-fixture', '--json'));
  assert.equal(blockedStatus.revision ?? blockedStatus.work.revision, 3);
  assert.equal(blockedStatus.nextTaskId, 'W2');
  assert.equal(blockedStatus.task.id, 'W2');
  const blockedPack = data(run('work', 'context-pack', '--work', 'execution-fixture', '--task', 'W1', '--json'));
  assert.equal(blockedPack.task.id, 'W1');
  assert.equal(blockedPack.task.status, 'blocked');
  assert.equal(blockedPack.task.blocker.reason, 'Required input is temporarily unavailable.');
  assert.equal(blockedPack.task.eligible, false);
  assert.equal(blockedPack.task.description, tasks[0].description);
  assert.equal(blockedPack.task.context, tasks[0].context);
  assert.deepEqual(blockedPack.task.filesToTouch, tasks[0].filesToTouch);
  assert(blockedPack.recipes.some((recipe) => recipe.includes('work unblock')));
  assert(!blockedPack.recipes.some((recipe) => recipe.includes('work start') || recipe.includes('work block')));

  const dependentBefore = readFileSync(join(root, '.agents/kyro/work/execution-fixture/work.json'));
  const rejectedDependent = mutation('start', 3, 'W3');
  assert.notEqual(rejectedDependent.status, 0, 'dependent must not start before prerequisite verification');
  assert.match(JSON.parse(rejectedDependent.stdout).error.message, /dependency W1 is blocked/);
  assert.deepEqual(readFileSync(join(root, '.agents/kyro/work/execution-fixture/work.json')), dependentBefore, 'ineligible start must preserve Work bytes');

  const startedIndependent = data(mutation('start', 3, 'W2'));
  assert.equal(startedIndependent.revision, 4);
  assert.equal(startedIndependent.status, 'in_progress');
  const activePack = data(run('work', 'context-pack', '--work', 'execution-fixture', '--task', 'W2', '--json'));
  assert.equal(activePack.task.eligible, false, 'an already-started task is not start-eligible');
  assert(activePack.recipes.some((recipe) => recipe.includes('work record-evidence')));
  assert(!activePack.recipes.some((recipe) => recipe.includes('work start')));
  const startedBlocked = data(mutation('unblock', 4, 'W1'));
  assert.equal(startedBlocked.revision, 5);
  assert.equal(startedBlocked.status, 'pending');
  assert.equal(startedBlocked.handoff.nextTaskId, 'W1', 'unblock must restore pending eligibility in stable order');
  const startedPrerequisite = data(mutation('start', 5, 'W1'));
  assert.equal(startedPrerequisite.revision, 6);
  assert.equal(startedPrerequisite.status, 'in_progress');

  const current = readFileSync(join(root, '.agents/kyro/work/execution-fixture/work.json'));
  const stale = mutation('block', 5, 'W1', '--reason', 'Stale transition.');
  assert.notEqual(stale.status, 0);
  assert.equal(JSON.parse(stale.stdout).error.code, 'STATE_DIVERGED');
  assert.deepEqual(readFileSync(join(root, '.agents/kyro/work/execution-fixture/work.json')), current);
  const unsafe = run('work', 'start', '--work', 'execution-fixture', '--task', '../W1', '--expect-revision', '6', '--json');
  assert.notEqual(unsafe.status, 0);

  const final = JSON.parse(readFileSync(join(root, '.agents/kyro/work/execution-fixture/work.json'), 'utf8'));
  assert.deepEqual(final.activity.slice(-4).map((event) => event.event), ['task_blocked', 'task_started', 'task_unblocked', 'task_started']);
  console.log('Work execution transition fixtures passed.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
