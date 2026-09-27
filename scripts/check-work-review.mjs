import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('dist/cli.js');
const root = mkdtempSync(join(tmpdir(), 'kyro-work-review-'));
try {
  writeFileSync(join(root, 'brief.md'), '# Review fixture\n\nProve criterion-complete task review and dependency release.\n');
  const criteria = ['Implementation meets the contract.', 'Regression coverage passes.'];
  const tasks = [
    { id: 'W1', title: 'Prerequisite', description: 'Complete and review the prerequisite.', context: '', filesToTouch: ['src/work.ts'], acceptanceCriteria: criteria, dependsOn: [] },
    { id: 'W2', title: 'Dependent', description: 'Become eligible only after W1 passes.', context: '', filesToTouch: ['src/dependent.ts'], acceptanceCriteria: ['Verified W1 enables this task.'], dependsOn: ['W1'] },
  ];
  const evidence = { summary: 'Implementation and checks are complete.', validations: [{ command: 'npm run check:work-review', result: 'passed', note: null }], filesChanged: ['src/work.ts'], notes: null };
  writeFileSync(join(root, 'plan.json'), JSON.stringify({ tasks }));
  writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, ...(args[0] === 'work' && args[1] === 'record-evidence' ? ['--by', 'fixture-maker'] : []), ...(args[0] === 'work' && args[1] === 'review' ? ['--by', 'fixture-checker'] : [])], { cwd: root, encoding: 'utf8' });
  const data = (result) => { assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout).data; };
  const workFile = (id) => join(root, '.agents/kyro/work', id, 'work.json');
  const createEvidence = (id, proposal = evidence) => {
    data(run('work', 'create', '--id', id, '--from', 'brief.md', '--json'));
    data(run('work', 'plan', '--work', id, '--from', 'plan.json', '--expect-revision', '1', '--json'));
    data(run('work', 'start', '--work', id, '--task', 'W1', '--expect-revision', '2', '--json'));
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(proposal));
    data(run('work', 'record-evidence', '--work', id, '--task', 'W1', '--from', 'evidence.json', '--expect-revision', '3', '--json'));
  };
  const review = (id, verdict, criteriaToCheck = criteria, findings = [], revision = '4') => {
    writeFileSync(join(root, 'review.json'), JSON.stringify({ checkedCriteria: criteriaToCheck, findings }));
    return run('work', 'review', '--work', id, '--task', 'W1', '--from', 'review.json', '--verdict', verdict, '--expect-revision', revision, '--json');
  };

  for (const [name, checked, findings, expected] of [
    ['missing criterion', [criteria[0]], [], /exact coverage.*missing/],
    ['extra criterion', [...criteria, 'Unrelated criterion.'], [], /exact coverage.*extra/],
    ['critical finding', criteria, [{ severity: 'critical', detail: 'A critical issue remains.' }], /critical finding/],
  ]) {
    const id = `reject-${name.replaceAll(' ', '-')}`;
    createEvidence(id);
    const before = readFileSync(workFile(id));
    const rejected = review(id, 'pass', checked, findings);
    assert.notEqual(rejected.status, 0, `${name} must prevent pass`);
    assert.match(JSON.parse(rejected.stdout).error.message, expected);
    assert.deepEqual(readFileSync(workFile(id)), before, `${name} must preserve Work bytes`);
  }

  createEvidence('reject-not-run', { ...evidence, validations: [{ command: 'npm run unrun', result: 'not_run', note: 'Not executed.' }] });
  const notRunBefore = readFileSync(workFile('reject-not-run'));
  const notRunPass = review('reject-not-run', 'pass');
  assert.notEqual(notRunPass.status, 0);
  assert.match(JSON.parse(notRunPass.stdout).error.message, /failed or not_run/);
  assert.deepEqual(readFileSync(workFile('reject-not-run')), notRunBefore);

  createEvidence('review-fail');
  writeFileSync(join(root, 'review.json'), JSON.stringify({ checkedCriteria: criteria, findings: [] }));
  const absentChecker = spawnSync(process.execPath, [cli, 'work', 'review', '--work', 'review-fail', '--task', 'W1', '--from', 'review.json', '--verdict', 'pass', '--expect-revision', '4', '--json'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(absentChecker.status, 0);
  assert.match(JSON.parse(absentChecker.stdout).error.message, /--by is required/);
  const selfReview = spawnSync(process.execPath, [cli, 'work', 'review', '--work', 'review-fail', '--task', 'W1', '--from', 'review.json', '--verdict', 'pass', '--expect-revision', '4', '--by', 'fixture-maker', '--json'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(selfReview.status, 0);
  assert.match(JSON.parse(selfReview.stdout).error.message, /evidence maker/);
  const failed = data(review('review-fail', 'fail', [criteria[0]], [{ severity: 'warning', detail: 'The second criterion is incomplete.' }]));
  assert.equal(failed.result, 'fail');
  assert.equal(failed.status, 'in_progress');
  assert.equal(failed.handoff.nextAction, 'execute_task');
  const failedWork = JSON.parse(readFileSync(workFile('review-fail'), 'utf8'));
  assert.equal(failedWork.activity.at(-1).event, 'review_recorded');
  assert.equal(failedWork.tasks[0].verdict.result, 'fail');
  const noFreshEvidence = run('work', 'review', '--work', 'review-fail', '--task', 'W1', '--from', 'review.json', '--verdict', 'pass', '--expect-revision', '5', '--json');
  assert.notEqual(noFreshEvidence.status, 0, 'fail verdict must require new evidence before another review');

  writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence));
  data(run('work', 'record-evidence', '--work', 'review-fail', '--task', 'W1', '--from', 'evidence.json', '--expect-revision', '5', '--json'));
  const passed = data(review('review-fail', 'pass', criteria, [], '6'));
  assert.equal(passed.result, 'pass');
  assert.equal(passed.status, 'verified');
  assert.equal(passed.handoff.nextTaskId, 'W2', 'verified predecessor must release its dependent');
  const status = data(run('work', 'status', '--work', 'review-fail', '--json'));
  assert.equal(status.nextAction, 'execute_task');
  assert.equal(status.nextTaskId, 'W2');
  const final = JSON.parse(readFileSync(workFile('review-fail'), 'utf8'));
  assert.deepEqual(final.tasks[0].verdict.checkedCriteria, criteria);
  assert.equal(final.tasks[0].verdict.evidenceDigest.length, 64);
  assert.equal(final.tasks[0].verdict.reviewedMaterialDigest, final.tasks[0].evidence.materialDigest);
  assert.equal(final.tasks[0].status, 'verified');

  createEvidence('block-after-fail');
  data(review('block-after-fail', 'fail', [criteria[0]], [{ severity: 'warning', detail: 'Remediation remains necessary.' }]));
  const blocked = data(run('work', 'block', '--work', 'block-after-fail', '--task', 'W1', '--reason', 'Waiting for the remediation dependency.', '--expect-revision', '5', '--json'));
  assert.equal(blocked.status, 'blocked');
  const blockedPack = data(run('work', 'context-pack', '--work', 'block-after-fail', '--json'));
  assert.equal(blockedPack.task.verdict.result, 'fail');
  assert(blockedPack.recipes.some((recipe) => recipe.includes('work unblock')));
  const resumed = data(run('work', 'unblock', '--work', 'block-after-fail', '--task', 'W1', '--expect-revision', '6', '--json'));
  assert.equal(resumed.status, 'in_progress');
  const resumedPack = data(run('work', 'context-pack', '--work', 'block-after-fail', '--json'));
  assert(resumedPack.recipes.some((recipe) => recipe.includes('work record-evidence')));
  assert(!resumedPack.recipes.some((recipe) => recipe.includes('work start')));
  writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence));
  data(run('work', 'record-evidence', '--work', 'block-after-fail', '--task', 'W1', '--from', 'evidence.json', '--expect-revision', '7', '--json'));
  assert.equal(data(review('block-after-fail', 'pass', criteria, [], '8')).status, 'verified');

  const stale = run('work', 'review', '--work', 'review-fail', '--task', 'W2', '--from', 'review.json', '--verdict', 'pass', '--expect-revision', '1', '--json');
  assert.notEqual(stale.status, 0);
  assert.equal(JSON.parse(stale.stdout).error.code, 'STATE_DIVERGED');
  console.log('Work review contract fixtures passed.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
