import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('dist/cli.js');
const root = mkdtempSync(join(tmpdir(), 'kyro-work-evidence-'));
try {
  writeFileSync(join(root, 'brief.md'), '# Evidence fixture\n\nValidate CLI-owned evidence with explicit actual validation outcomes.\n');
  const tasks = [{ id: 'W1', title: 'Implement contract', description: 'Implement the contract and record its real checks.', context: '', filesToTouch: ['src/work.ts'], acceptanceCriteria: ['Contract behavior is verified.'], dependsOn: [] }];
  const proposal = { summary: 'The task implementation is complete.', validations: [{ command: 'npm run check:work-evidence', result: 'passed', note: null }], filesChanged: ['src/work.ts'], notes: null };
  writeFileSync(join(root, 'plan.json'), JSON.stringify({ tasks }));
  writeFileSync(join(root, 'evidence.json'), JSON.stringify(proposal));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, ...(args[0] === 'work' && args[1] === 'record-evidence' ? ['--by', 'fixture-maker'] : [])], { cwd: root, encoding: 'utf8' });
  const data = (result) => { assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout).data; };
  const createAndPlan = (id) => {
    data(run('work', 'create', '--id', id, '--from', 'brief.md', '--json'));
    data(run('work', 'plan', '--work', id, '--from', 'plan.json', '--expect-revision', '1', '--json'));
  };
  const path = (id) => join(root, '.agents/kyro/work', id, 'work.json');
  createAndPlan('evidence-valid');
  const pendingBytes = readFileSync(path('evidence-valid'));
  const pendingEvidence = run('work', 'record-evidence', '--work', 'evidence-valid', '--task', 'W1', '--from', 'evidence.json', '--expect-revision', '2', '--json');
  assert.notEqual(pendingEvidence.status, 0, 'pending tasks must reject evidence');
  assert.deepEqual(readFileSync(path('evidence-valid')), pendingBytes);
  data(run('work', 'start', '--work', 'evidence-valid', '--task', 'W1', '--expect-revision', '2', '--json'));
  const startedBytes = readFileSync(path('evidence-valid'));
  const absentMaker = spawnSync(process.execPath, [cli, 'work', 'record-evidence', '--work', 'evidence-valid', '--task', 'W1', '--from', 'evidence.json', '--expect-revision', '3', '--json'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(absentMaker.status, 0);
  assert.match(JSON.parse(absentMaker.stdout).error.message, /--by is required/);
  assert.deepEqual(readFileSync(path('evidence-valid')), startedBytes);
  const preview = data(run('work', 'record-evidence', '--work', 'evidence-valid', '--task', 'W1', '--from', 'evidence.json', '--expect-revision', '3', '--dry-run', '--json'));
  assert.equal(preview.status, 'awaiting_review');
  assert.deepEqual(readFileSync(path('evidence-valid')), startedBytes, 'evidence preview must not write');
  const committed = data(run('work', 'record-evidence', '--work', 'evidence-valid', '--task', 'W1', '--from', 'evidence.json', '--expect-revision', '3', '--json'));
  const work = JSON.parse(readFileSync(path('evidence-valid'), 'utf8'));
  const evidence = work.tasks[0].evidence;
  assert.equal(work.revision, 4);
  assert.equal(work.tasks[0].status, 'awaiting_review');
  assert.deepEqual(Object.keys(evidence).sort(), ['summary', 'validations', 'filesChanged', 'notes', 'by', 'recordedAt', 'definitionRevision', 'materialDigest'].sort());
  assert.equal(evidence.definitionRevision, 1);
  assert.equal(evidence.materialDigest, committed.materialDigest);
  assert.equal(evidence.materialDigest.length, 64);
  assert.equal(evidence.by, 'fixture-maker');
  assert.equal(work.activity.at(-1).event, 'evidence_recorded');
  const evidencePack = data(run('work', 'context-pack', '--work', 'evidence-valid', '--json'));
  assert.deepEqual(evidencePack.task.evidence.validations, proposal.validations);
  assert.equal(evidencePack.task.evidence.validationProvenance, 'maker_reported');
  const validCommitted = readFileSync(path('evidence-valid'));

  createAndPlan('evidence-honest');
  data(run('work', 'start', '--work', 'evidence-honest', '--task', 'W1', '--expect-revision', '2', '--json'));
  const honest = { ...proposal, validations: [{ command: 'npm run missing-check', result: 'not_run', note: 'Not run in this workspace.' }] };
  writeFileSync(join(root, 'evidence.json'), JSON.stringify(honest));
  data(run('work', 'record-evidence', '--work', 'evidence-honest', '--task', 'W1', '--from', 'evidence.json', '--expect-revision', '3', '--json'));
  const honestView = data(run('work', 'status', '--work', 'evidence-honest', '--json'));
  assert.equal(honestView.nextAction, 'review_task');
  assert.equal(honestView.task.evidence.validations[0].result, 'not_run');
  assert.equal(honestView.task.verdict, null, 'unrun validations must never imply a pass verdict');

  createAndPlan('evidence-invalid');
  data(run('work', 'start', '--work', 'evidence-invalid', '--task', 'W1', '--expect-revision', '2', '--json'));
  const prior = readFileSync(path('evidence-invalid'));
  writeFileSync(join(root, 'evidence.json'), JSON.stringify({ ...proposal, filesChanged: ['../outside'] }));
  const invalid = run('work', 'record-evidence', '--work', 'evidence-invalid', '--task', 'W1', '--from', 'evidence.json', '--expect-revision', '3', '--json');
  assert.notEqual(invalid.status, 0);
  assert.match(JSON.parse(invalid.stdout).error.message, /safe relative paths/);
  assert.deepEqual(readFileSync(path('evidence-invalid')), prior);
  writeFileSync(join(root, 'evidence.json'), JSON.stringify(proposal));
  const stale = run('work', 'record-evidence', '--work', 'evidence-valid', '--task', 'W1', '--from', 'evidence.json', '--expect-revision', '3', '--json');
  assert.notEqual(stale.status, 0);
  assert.equal(JSON.parse(stale.stdout).error.code, 'STATE_DIVERGED');
  assert.deepEqual(readFileSync(path('evidence-valid')), validCommitted);
  console.log('Work evidence contract fixtures passed.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
