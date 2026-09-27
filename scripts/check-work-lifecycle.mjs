import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateWorkFile } from '../dist/cli/work/schema.js';

const cli = resolve('dist/cli.js');
const root = mkdtempSync(join(tmpdir(), 'kyro-work-lifecycle-'));
try {
  const write = (path, content) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); };
  write('brief.md', '# Lifecycle fixture\n\nExercise the full Work task lifecycle with isolated state snapshots.\n');
  write('.agents/kyro/project.json', '{"project":"preserve"}\n');
  write('.agents/kyro/local.json', '{"local":"preserve"}\n');
  write('.agents/kyro/scopes/existing/sprint.json', '{"sprint":"preserve"}\n');
  write('.agents/kyro/scopes/existing/archive/sprint.json', '{"archive":"preserve"}\n');
  const criteriaOne = ['The parser accepts supported syntax.', 'Invalid syntax has a useful diagnostic.'];
  const criteriaTwo = ['Independent work completes while a prerequisite is blocked.'];
  const tasks = [
    { id: 'W1', title: 'Build parser', description: 'Implement supported search syntax and diagnostics.', context: '', filesToTouch: ['src/search/parser.ts'], acceptanceCriteria: criteriaOne, dependsOn: [] },
    { id: 'W2', title: 'Independent documentation', description: 'Document the supported query syntax independently.', context: '', filesToTouch: ['docs/search.md'], acceptanceCriteria: criteriaTwo, dependsOn: [] },
    { id: 'W3', title: 'Integrate parser', description: 'Integrate the parser only after W1 is verified.', context: '', filesToTouch: ['src/cli/search.ts'], acceptanceCriteria: ['The CLI uses verified parser behavior.'], dependsOn: ['W1'] },
  ];
  write('plan.json', JSON.stringify({ tasks }));
  const goodEvidence = { summary: 'The parser and its validations are complete.', validations: [{ command: 'npm run check:work-lifecycle', result: 'passed', note: null }], filesChanged: ['src/search/parser.ts'], notes: null };
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args, ...(args[0] === 'work' && args[1] === 'record-evidence' ? ['--by', 'fixture-maker'] : []), ...(args[0] === 'work' && args[1] === 'review' ? ['--by', 'fixture-checker'] : [])], { cwd: root, encoding: 'utf8' });
    const mutating = new Set(['create', 'plan', 'start', 'block', 'unblock', 'record-evidence', 'review', 'amend-task', 'amend-brief', 'dispose', 'close', 'reopen']);
    if (result.status === 0 && args[0] === 'work' && mutating.has(args[1]) && !args.includes('--dry-run')) {
      const idFlag = args[1] === 'create' ? '--id' : '--work';
      const id = args[args.indexOf(idFlag) + 1];
      const path = join(root, '.agents/kyro/work', id, 'work.json');
      const document = JSON.parse(readFileSync(path, 'utf8'));
      assert.deepEqual(validateWorkFile(document, path), [], `${args[1]} must publish a valid Work document`);
      const status = spawnSync(process.execPath, [cli, 'work', 'status', '--work', id, '--json'], { cwd: root, encoding: 'utf8' });
      assert.equal(status.status, 0, `${args[1]} must leave a readable Work status`);
      const observed = JSON.parse(status.stdout).data;
      assert.equal(observed.work.revision, document.revision, `${args[1]} status revision must match persisted state`);
      assert.equal(observed.nextAction, document.handoff.nextAction, `${args[1]} status handoff must match persisted state`);
      assert.equal(observed.nextTaskId, document.handoff.nextTaskId, `${args[1]} status task must match persisted state`);
    }
    return result;
  };
  const data = (result) => { assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout).data; };
  const error = (result, pattern) => { assert.notEqual(result.status, 0, 'command must fail'); const envelope = JSON.parse(result.stdout); assert.equal(envelope.ok, false); assert.match(envelope.error.message, pattern); return envelope.error; };
  const workPath = (id) => join(root, '.agents/kyro/work', id, 'work.json');
  const reviewInput = (criteria, findings = []) => write('review.json', JSON.stringify({ checkedCriteria: criteria, findings }));
  const evidenceInput = (value) => write('evidence.json', JSON.stringify(value));
  const snapshotPaths = [
    '.agents/kyro/project.json', '.agents/kyro/local.json',
    '.agents/kyro/scopes/existing/sprint.json', '.agents/kyro/scopes/existing/archive/sprint.json',
  ];
  const before = new Map(snapshotPaths.map((path) => [path, readFileSync(join(root, path))]));

  data(run('work', 'create', '--id', 'lifecycle', '--from', 'brief.md', '--json'));
  const created = readFileSync(workPath('lifecycle'));
  const invalidGraph = { tasks: [{ ...tasks[0], dependsOn: ['W9'] }] };
  write('invalid-plan.json', JSON.stringify(invalidGraph));
  error(run('work', 'plan', '--work', 'lifecycle', '--from', 'invalid-plan.json', '--expect-revision', '1', '--json'), /dependency W9/);
  assert.deepEqual(readFileSync(workPath('lifecycle')), created, 'invalid graph must preserve prior Work bytes');
  data(run('work', 'plan', '--work', 'lifecycle', '--from', 'plan.json', '--expect-revision', '1', '--json'));
  const planned = readFileSync(workPath('lifecycle'));
  const ineligible = run('work', 'start', '--work', 'lifecycle', '--task', 'W3', '--expect-revision', '2', '--json');
  error(ineligible, /dependency W1 is pending/);
  assert.deepEqual(readFileSync(workPath('lifecycle')), planned, 'blocked prerequisite must prevent a write');

  const blocked = data(run('work', 'block', '--work', 'lifecycle', '--task', 'W1', '--reason', 'Waiting for a reviewed interface.', '--expect-revision', '2', '--json'));
  assert.equal(blocked.handoff.nextTaskId, 'W2', 'independent task must remain eligible during a block');
  const independent = data(run('work', 'start', '--work', 'lifecycle', '--task', 'W2', '--expect-revision', '3', '--json'));
  assert.equal(independent.status, 'in_progress');
  data(run('work', 'unblock', '--work', 'lifecycle', '--task', 'W1', '--expect-revision', '4', '--json'));
  data(run('work', 'start', '--work', 'lifecycle', '--task', 'W1', '--expect-revision', '5', '--json'));

  evidenceInput({ ...goodEvidence, validations: [{ command: 'npm run unrun', result: 'not_run', note: 'Not executed.' }] });
  const badEvidenceBytes = readFileSync(workPath('lifecycle'));
  const evidencePreview = data(run('work', 'record-evidence', '--work', 'lifecycle', '--task', 'W1', '--from', 'evidence.json', '--expect-revision', '6', '--dry-run', '--json'));
  assert.equal(evidencePreview.validations[0].result, 'not_run');
  assert.deepEqual(readFileSync(workPath('lifecycle')), badEvidenceBytes, 'evidence preview must remain read-only');
  data(run('work', 'record-evidence', '--work', 'lifecycle', '--task', 'W1', '--from', 'evidence.json', '--expect-revision', '6', '--json'));
  const reviewPack = data(run('work', 'context-pack', '--work', 'lifecycle', '--json'));
  assert.equal(reviewPack.nextAction, 'review_task');
  assert(reviewPack.recipes.some((recipe) => recipe.includes('work review')));
  assert(!reviewPack.recipes.some((recipe) => recipe.includes('work start') || recipe.includes('work block')));
  reviewInput(criteriaOne);
  const failedPass = run('work', 'review', '--work', 'lifecycle', '--task', 'W1', '--from', 'review.json', '--verdict', 'pass', '--expect-revision', '7', '--json');
  error(failedPass, /failed or not_run/);
  reviewInput([criteriaOne[0]], [{ severity: 'warning', detail: 'The diagnostic criterion is incomplete.' }]);
  const failedReview = data(run('work', 'review', '--work', 'lifecycle', '--task', 'W1', '--from', 'review.json', '--verdict', 'fail', '--expect-revision', '7', '--json'));
  assert.equal(failedReview.status, 'in_progress');
  const failedWork = readFileSync(workPath('lifecycle'));
  const freshReview = run('work', 'review', '--work', 'lifecycle', '--task', 'W1', '--from', 'review.json', '--verdict', 'pass', '--expect-revision', '8', '--json');
  error(freshReview, /not awaiting review with fresh evidence/);
  assert.deepEqual(readFileSync(workPath('lifecycle')), failedWork, 'review without fresh evidence must not change Work');

  evidenceInput(goodEvidence);
  data(run('work', 'record-evidence', '--work', 'lifecycle', '--task', 'W1', '--from', 'evidence.json', '--expect-revision', '8', '--json'));
  reviewInput(criteriaOne);
  const freshEvidenceWork = readFileSync(workPath('lifecycle'));
  const staleRevision = run('work', 'review', '--work', 'lifecycle', '--task', 'W1', '--from', 'review.json', '--verdict', 'pass', '--expect-revision', '8', '--json');
  error(staleRevision, /revision .* does not match expected/);
  assert.deepEqual(readFileSync(workPath('lifecycle')), freshEvidenceWork, 'stale expected revision must preserve Work bytes');
  const passOne = data(run('work', 'review', '--work', 'lifecycle', '--task', 'W1', '--from', 'review.json', '--verdict', 'pass', '--expect-revision', '9', '--json'));
  assert.equal(passOne.status, 'verified');
  const dependentPack = data(run('work', 'context-pack', '--work', 'lifecycle', '--task', 'W3', '--json'));
  assert.equal(dependentPack.task.eligible, true);
  assert.equal(dependentPack.task.prerequisites[0].status, 'verified');

  evidenceInput({ ...goodEvidence, filesChanged: ['../outside'] });
  const beforeInvalidEvidence = readFileSync(workPath('lifecycle'));
  error(run('work', 'record-evidence', '--work', 'lifecycle', '--task', 'W2', '--from', 'evidence.json', '--expect-revision', '10', '--json'), /safe relative paths/);
  assert.deepEqual(readFileSync(workPath('lifecycle')), beforeInvalidEvidence, 'invalid evidence must preserve current Work bytes');
  evidenceInput(goodEvidence);
  data(run('work', 'record-evidence', '--work', 'lifecycle', '--task', 'W2', '--from', 'evidence.json', '--expect-revision', '10', '--json'));
  reviewInput(criteriaTwo);
  data(run('work', 'review', '--work', 'lifecycle', '--task', 'W2', '--from', 'review.json', '--verdict', 'pass', '--expect-revision', '11', '--json'));
  const selected = data(run('work', 'status', '--work', 'lifecycle', '--json'));
  assert.equal(selected.nextTaskId, 'W3');
  data(run('work', 'start', '--work', 'lifecycle', '--task', 'W3', '--expect-revision', '12', '--json'));
  evidenceInput({ ...goodEvidence, filesChanged: ['src/cli/search.ts'] });
  data(run('work', 'record-evidence', '--work', 'lifecycle', '--task', 'W3', '--from', 'evidence.json', '--expect-revision', '13', '--json'));
  reviewInput(['The CLI uses verified parser behavior.']);
  const passThree = data(run('work', 'review', '--work', 'lifecycle', '--task', 'W3', '--from', 'review.json', '--verdict', 'pass', '--expect-revision', '14', '--json'));
  assert.equal(passThree.status, 'verified');

  data(run('work', 'create', '--id', 'stale-evidence', '--from', 'brief.md', '--json'));
  data(run('work', 'plan', '--work', 'stale-evidence', '--from', 'plan.json', '--expect-revision', '1', '--json'));
  data(run('work', 'start', '--work', 'stale-evidence', '--task', 'W1', '--expect-revision', '2', '--json'));
  evidenceInput(goodEvidence);
  data(run('work', 'record-evidence', '--work', 'stale-evidence', '--task', 'W1', '--from', 'evidence.json', '--expect-revision', '3', '--json'));
  const staleEvidenceBytes = readFileSync(workPath('stale-evidence'));
  write('.agents/kyro/work/stale-evidence/brief.md', '# Changed outside the CLI\n\nThis change invalidates evidence material.\n');
  const anomalyPack = data(run('work', 'context-pack', '--work', 'stale-evidence', '--json'));
  assert.equal(anomalyPack.nextAction, 'resolve_blocker');
  assert.deepEqual(anomalyPack.recipes, ['kyro work status --work stale-evidence --json']);
  reviewInput(criteriaOne);
  const staleMaterial = run('work', 'review', '--work', 'stale-evidence', '--task', 'W1', '--from', 'review.json', '--verdict', 'pass', '--expect-revision', '4', '--json');
  error(staleMaterial, /brief digest does not match/);
  assert.deepEqual(readFileSync(workPath('stale-evidence')), staleEvidenceBytes, 'stale brief material must preserve Work state and cannot pass review');

  for (const [path, bytes] of before) assert.deepEqual(readFileSync(join(root, path)), bytes, `${path} must remain byte-identical across Work commands`);
  const main = JSON.parse(readFileSync(workPath('lifecycle'), 'utf8'));
  assert.deepEqual(main.tasks.map((task) => task.status), ['verified', 'verified', 'verified']);
  assert.deepEqual(main.activity.filter((item) => item.event === 'review_recorded').map((item) => item.taskId), ['W1', 'W1', 'W2', 'W3']);
  assert.equal(main.handoff.nextAction, 'ready_to_close', 'all tasks verified must derive a close-ready handoff without closing Work');
  const inspect = (id) => {
    const document = JSON.parse(readFileSync(workPath(id), 'utf8'));
    assert.deepEqual(validateWorkFile(document, workPath(id)), [], `${id} must validate after every lifecycle mutation`);
    const current = data(run('work', 'status', '--work', id, '--json'));
    assert.equal(current.work.revision, document.revision);
    assert.equal(current.nextAction, document.handoff.nextAction);
    assert.equal(current.nextTaskId, document.handoff.nextTaskId);
    return current;
  };
  const applied = (id, ...args) => { const result = data(run('work', ...args, '--json')); inspect(id); return result; };
  const revision = (id) => String(inspect(id).work.revision);
  const amendedTask = { ...tasks[0], title: 'Build parser with audited diagnostics', acceptanceCriteria: [...criteriaOne, 'Parser errors include a stable code.'] };
  delete amendedTask.id;
  write('amend-task.json', JSON.stringify(amendedTask));
  const amendment = applied('lifecycle', 'amend-task', '--work', 'lifecycle', '--task', 'W1', '--from', 'amend-task.json', '--reason', 'Add stable diagnostics.', '--by', 'fixture-maintainer', '--expect-revision', revision('lifecycle'));
  assert.deepEqual(amendment.invalidatedTaskIds, ['W1', 'W3']);
  assert.deepEqual(inspect('lifecycle').tasks.map((task) => task.status), ['pending', 'verified', 'pending']);
  const staleBefore = readFileSync(workPath('lifecycle'));
  error(run('work', 'review', '--work', 'lifecycle', '--task', 'W1', '--from', 'review.json', '--verdict', 'pass', '--expect-revision', revision('lifecycle'), '--json'), /not awaiting review with fresh evidence/);
  assert.deepEqual(readFileSync(workPath('lifecycle')), staleBefore, 'amended task cannot reuse an old pass');
  write('amended-brief.md', '# Lifecycle fixture\r\n\r\nExercise the amended Work task lifecycle with exact CRLF bytes.\r\n');
  const briefAmendment = applied('lifecycle', 'amend-brief', '--work', 'lifecycle', '--from', 'amended-brief.md', '--reason', 'Clarify the lifecycle outcome.', '--by', 'fixture-maintainer', '--expect-revision', revision('lifecycle'));
  assert(briefAmendment.invalidatedTaskIds.includes('W2'), 'brief amendment must invalidate remaining approval');
  assert.deepEqual(inspect('lifecycle').tasks.map((task) => task.status), ['pending', 'pending', 'pending']);
  for (const taskId of ['W1', 'W2', 'W3']) {
    applied('lifecycle', 'dispose', '--work', 'lifecycle', '--task', taskId, '--kind', 'cancelled', '--reason', 'Superseded by the lifecycle fixture outcome.', '--by', 'fixture-maintainer', '--expect-revision', revision('lifecycle'));
  }
  const closePreviewBytes = readFileSync(workPath('lifecycle'));
  const closePreview = data(run('work', 'close', '--work', 'lifecycle', '--outcome', 'completed', '--reason', 'All remaining tasks were explicitly disposed.', '--by', 'fixture-maintainer', '--expect-revision', revision('lifecycle'), '--dry-run', '--json'));
  assert.deepEqual(closePreview.summary.disposed, ['W1', 'W2', 'W3']);
  assert.deepEqual(readFileSync(workPath('lifecycle')), closePreviewBytes, 'close preview must not write');
  const completed = applied('lifecycle', 'close', '--work', 'lifecycle', '--outcome', 'completed', '--reason', 'All remaining tasks were explicitly disposed.', '--by', 'fixture-maintainer', '--expect-revision', revision('lifecycle'), '--yes');
  assert.equal(completed.state, 'closed');
  const reopened = applied('lifecycle', 'reopen', '--work', 'lifecycle', '--reason', 'Continue after the recorded closure.', '--by', 'fixture-maintainer', '--expect-revision', revision('lifecycle'), '--yes');
  assert.equal(reopened.state, 'active');
  assert(readFileSync(join(root, reopened.closureHistoryPath)).includes('completed'), 'reopen must preserve the prior closure');

  data(run('work', 'create', '--id', 'stopped-case', '--from', 'brief.md', '--json'));
  inspect('stopped-case');
  applied('stopped-case', 'plan', '--work', 'stopped-case', '--from', 'plan.json', '--expect-revision', '1');
  const stopped = applied('stopped-case', 'close', '--work', 'stopped-case', '--outcome', 'stopped', '--reason', 'Work was explicitly halted with unresolved tasks.', '--by', 'fixture-maintainer', '--expect-revision', revision('stopped-case'), '--yes');
  assert.deepEqual(stopped.summary.unresolved, ['W1', 'W2', 'W3']);
  const stoppedReopen = applied('stopped-case', 'reopen', '--work', 'stopped-case', '--reason', 'Resume halted work.', '--by', 'fixture-maintainer', '--expect-revision', revision('stopped-case'), '--yes');
  assert.equal(stoppedReopen.state, 'active');
  assert.equal(inspect('stopped-case').nextAction, 'execute_task');

  for (const [path, bytes] of before) assert.deepEqual(readFileSync(join(root, path)), bytes, `${path} must remain byte-identical after Sprint 3 mutations`);
  console.log('Work end-to-end lifecycle and Forge-state isolation fixtures passed.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
