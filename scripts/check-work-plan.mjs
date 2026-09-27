import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { hasDependencyCycle } from '../dist/cli/work/schema.js';

const cli = resolve('dist/cli.js');
const root = mkdtempSync(join(tmpdir(), 'kyro-work-plan-'));
try {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'brief.md'), '# Planning fixture\n\nValidate Work task graph planning through the CLI-owned writer.\n');
  const validTasks = [
    { id: 'W1', title: 'Build parser', description: 'Implement the first independently runnable task.', context: '', filesToTouch: ['src/parser.ts'], acceptanceCriteria: ['Parser handles valid input.'], dependsOn: [] },
    { id: 'W2', title: 'Add formatter', description: 'Implement an independent formatter task.', context: '', filesToTouch: ['src/format.ts'], acceptanceCriteria: ['Formatter emits stable output.'], dependsOn: [] },
    { id: 'W3', title: 'Integrate parser', description: 'Integrate the parser after its predecessor verifies.', context: '', filesToTouch: ['src/integration.ts'], acceptanceCriteria: ['Integration consumes verified parser output.'], dependsOn: ['W1'] },
  ];
  let nextId = 0;
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const data = (result) => {
    assert.equal(result.status, 0, `CLI status=${result.status}, stdoutBytes=${result.stdout.length}: ${(result.stderr || result.stdout).slice(0, 800)}`);
    return JSON.parse(result.stdout).data;
  };
  const create = () => {
    const id = `plan-fixture-${++nextId}`;
    data(run('work', 'create', '--id', id, '--from', 'brief.md', '--json'));
    return id;
  };
  const writeProposal = (proposal) => writeFileSync(join(root, 'proposal.json'), JSON.stringify(proposal));
  const plan = (id, proposal = { tasks: validTasks }, revision = '1', ...extra) => {
    writeProposal(proposal);
    return run('work', 'plan', '--work', id, '--from', 'proposal.json', '--expect-revision', revision, ...extra, '--json');
  };

  const validId = create();
  const before = readFileSync(join(root, '.agents/kyro/work', validId, 'work.json'));
  const preview = data(plan(validId, { tasks: validTasks }, '1', '--dry-run'));
  assert.equal(preview.dryRun, true);
  assert.deepEqual(readFileSync(join(root, '.agents/kyro/work', validId, 'work.json')), before, 'dry-run must preserve Work bytes');
  const applied = data(plan(validId));
  const workPath = join(root, '.agents/kyro/work', validId, 'work.json');
  const committed = readFileSync(workPath);
  const work = JSON.parse(committed);
  assert.equal(work.revision, 2);
  assert.equal(work.state, 'active');
  assert.deepEqual(work.tasks.map((task) => task.id), ['W1', 'W2', 'W3']);
  assert(work.tasks.every((task) => task.definitionRevision === 1 && task.status === 'pending' && task.evidence === null && task.verdict === null));
  assert.deepEqual(work.handoff, { nextAction: 'execute_task', nextTaskId: 'W1', blockedReason: null });
  assert.equal(work.activity.at(-1).event, 'tasks_planned');
  assert.equal(work.revision, applied.revision, 'CLI preview and committed revision must agree');

  const invalidCases = [
    ['unknown task field', { tasks: [{ ...validTasks[0], unexpected: true }] }, /tasks\[0\]\.unexpected/],
    ['duplicate task ID', { tasks: [{ ...validTasks[0] }, { ...validTasks[1], id: 'W1' }] }, /tasks\[1\]\.id/],
    ['skipped task ID', { tasks: [{ ...validTasks[0], id: 'W2' }] }, /tasks\[0\]\.id/],
    ['duplicate normalized criteria', { tasks: [{ ...validTasks[0], acceptanceCriteria: ['A criterion', ' a   CRITERION '] }] }, /duplicate criteria after normalization/],
    ['unsafe file path', { tasks: [{ ...validTasks[0], filesToTouch: ['../outside'] }] }, /filesToTouch/],
    ['missing dependency', { tasks: [{ ...validTasks[0], dependsOn: ['W9'] }] }, /dependency W9.*does not exist/],
    ['self dependency', { tasks: [{ ...validTasks[0], dependsOn: ['W1'] }] }, /self-dependency/],
    ['cycle', { tasks: [{ ...validTasks[0], dependsOn: ['W2'] }, { ...validTasks[1], dependsOn: ['W1'] }] }, /dependency cycle/],
    ['unknown proposal field', { tasks: validTasks, unexpected: true }, /exactly one tasks array/],
  ];
  for (const [name, proposal, expected] of invalidCases) {
    const id = create();
    const prior = readFileSync(join(root, '.agents/kyro/work', id, 'work.json'));
    const rejected = plan(id, proposal);
    assert.notEqual(rejected.status, 0, `${name} must be rejected`);
    const envelope = JSON.parse(rejected.stdout);
    assert.equal(envelope.ok, false, `${name} must return a CLI error envelope`);
    assert.match(envelope.error.message, expected, `${name} must report a precise error`);
    assert.deepEqual(readFileSync(join(root, '.agents/kyro/work', id, 'work.json')), prior, `${name} must preserve prior Work bytes`);
  }

  writeProposal({ tasks: validTasks });
  const stale = run('work', 'plan', '--work', validId, '--from', 'proposal.json', '--expect-revision', '1', '--json');
  assert.notEqual(stale.status, 0, 'stale expected revision must fail');
  assert.equal(JSON.parse(stale.stdout).error.code, 'STATE_DIVERGED');
  assert.deepEqual(readFileSync(workPath), committed, 'stale revision must preserve the winning update');

  const graphSize = 2_500;
  const longChain = Array.from({ length: graphSize }, (_, index) => ({
    ...validTasks[0], id: `W${index + 1}`, title: `Task ${index + 1}`,
    dependsOn: index === 0 ? [] : [`W${index}`],
  }));
  assert.equal(hasDependencyCycle(longChain), false, 'a long chain must not overflow the call stack');
  const deepCycle = longChain.map((task, index) => index === 0 ? { ...task, dependsOn: [`W${graphSize}`] } : task);
  assert.equal(hasDependencyCycle(deepCycle), true, 'a deep cycle must be detected iteratively');
  const veryDeep = Array.from({ length: 20_000 }, (_, index) => ({ id: `W${index + 1}`, dependsOn: index === 0 ? [] : [`W${index}`] }));
  assert.equal(hasDependencyCycle(veryDeep), false, 'cycle detection must handle a 20,000-task chain without recursion');
  veryDeep[0].dependsOn = ['W20000'];
  assert.equal(hasDependencyCycle(veryDeep), true, 'cycle detection must detect a 20,000-task cycle without recursion');
  const broad = longChain.map((task) => ({ ...task, dependsOn: [] }));
  assert.equal(hasDependencyCycle(broad), false);
  const largeId = create();
  const largePlan = data(plan(largeId, { tasks: longChain }));
  assert.equal(largePlan.handoff.nextTaskId, 'W1');
  const largeStatus = data(run('work', 'status', '--work', largeId, '--json'));
  assert.equal(largeStatus.tasks.length, graphSize);
  assert.equal(largeStatus.tasks.filter((task) => task.eligible).length, 1);
  const cycleId = create();
  const cycleBefore = readFileSync(join(root, '.agents/kyro/work', cycleId, 'work.json'));
  const deepCycleResult = plan(cycleId, { tasks: deepCycle });
  assert.notEqual(deepCycleResult.status, 0);
  assert.match(JSON.parse(deepCycleResult.stdout).error.message, /dependency cycle/);
  assert.deepEqual(readFileSync(join(root, '.agents/kyro/work', cycleId, 'work.json')), cycleBefore);
  const broadId = create();
  assert.equal(data(plan(broadId, { tasks: broad })).handoff.nextTaskId, 'W1');
  const oversizedId = create();
  const oversizedBefore = readFileSync(join(root, '.agents/kyro/work', oversizedId, 'work.json'));
  writeProposal({ tasks: [] });
  writeFileSync(join(root, 'proposal.json'), ' '.repeat(16_777_217));
  const oversized = run('work', 'plan', '--work', oversizedId, '--from', 'proposal.json', '--expect-revision', '1', '--json');
  assert.notEqual(oversized.status, 0);
  assert.match(JSON.parse(oversized.stdout).error.message, /16 MiB input limit/);
  assert.deepEqual(readFileSync(join(root, '.agents/kyro/work', oversizedId, 'work.json')), oversizedBefore);
  console.log('Work plan contract fixtures passed.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
