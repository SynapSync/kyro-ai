import assert from 'node:assert/strict';
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateWorkFile } from '../dist/cli/work/schema.js';
import { readBoundedBriefDescriptor } from '../dist/cli/commands/work.js';

const cli = resolve('dist/cli.js');
const root = mkdtempSync(join(tmpdir(), 'kyro-work-amend-'));
try {
  mkdirSync(join(root, '.agents/kyro/scopes/forge-existing'), { recursive: true });
  const forgeSentinels = ['.agents/kyro/project.json', '.agents/kyro/local.json', '.agents/kyro/scopes/forge-existing/sprint.json'];
  forgeSentinels.forEach((path) => writeFileSync(join(root, path), `{"sentinel":"${path}"}\n`));
  const forgeBefore = forgeSentinels.map((path) => readFileSync(join(root, path)));
  writeFileSync(join(root, 'brief.md'), '# Amendment fixture\n\nValidate CLI-owned task and brief amendments with digest-bound invalidation.\n');
  const tasks = [
    { id: 'W1', title: 'First task', description: 'Deliver the first independently verifiable unit.', context: '', filesToTouch: ['src/first.ts'], acceptanceCriteria: ['First output is verified.'], dependsOn: [] },
    { id: 'W2', title: 'Second task', description: 'Deliver the second unit after the first verifies.', context: '', filesToTouch: ['src/second.ts'], acceptanceCriteria: ['Second output is verified.'], dependsOn: ['W1'] },
    { id: 'W3', title: 'Third task', description: 'Integrate both units into the final outcome.', context: '', filesToTouch: ['src/third.ts'], acceptanceCriteria: ['Integration output is verified.'], dependsOn: ['W2'] },
  ];
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const data = (result) => {
    assert.equal(result.status, 0, `CLI status=${result.status}, output=${(result.stderr || result.stdout).slice(0, 800)}`);
    return JSON.parse(result.stdout).data;
  };
  const fail = (result, code) => {
    assert.notEqual(result.status, 0, 'expected the CLI to reject this input');
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, false, 'rejection must use the CLI error envelope');
    if (code) assert.equal(envelope.error.code, code, `expected error code ${code}`);
    return envelope;
  };
  const workPath = (id) => join(root, '.agents/kyro/work', id, 'work.json');
  const briefPath = (id) => join(root, '.agents/kyro/work', id, 'brief.md');
  const pendingPath = (id) => join(root, '.agents/kyro/work', id, '.pending-brief-amendment.json');
  const snapshot = (id) => ({ json: readFileSync(workPath(id)), brief: readFileSync(briefPath(id)) });
  const assertUnchanged = (id, before, label) => {
    assert.deepEqual(readFileSync(workPath(id)), before.json, `${label} must preserve work.json bytes`);
    assert.deepEqual(readFileSync(briefPath(id)), before.brief, `${label} must preserve brief.md bytes`);
  };
  const assertValidWork = (id, label) => {
    const work = JSON.parse(readFileSync(workPath(id), 'utf8'));
    assert.deepEqual(validateWorkFile(work, workPath(id)), [], `${label} must leave a schema-valid Work document`);
    return work;
  };
  const planNewWork = (id) => {
    data(run('work', 'create', '--id', id, '--from', 'brief.md', '--json'));
    writeFileSync(join(root, 'proposal.json'), JSON.stringify({ tasks }));
    data(run('work', 'plan', '--work', id, '--from', 'proposal.json', '--expect-revision', '1', '--json'));
  };
  const amendTask = (id, taskId, amendment, revision, ...extra) => {
    writeFileSync(join(root, 'amend.json'), JSON.stringify(amendment));
    return run('work', 'amend-task', '--work', id, '--task', taskId, '--from', 'amend.json', '--expect-revision', revision, ...extra, '--json');
  };
  const withReason = (actor = 'amend-maker') => ['--reason', 'Amendment fixture change.', '--by', actor];
  const verifyTask = (id, taskId, revision, criteria) => {
    data(run('work', 'start', '--work', id, '--task', taskId, '--expect-revision', String(revision), '--json'));
    writeFileSync(join(root, 'evidence.json'), JSON.stringify({
      summary: `Implemented ${taskId}.`, validations: [{ command: 'node scripts/check-work-amend.mjs', result: 'passed', note: null }], filesChanged: ['src/first.ts'], notes: null,
    }));
    data(run('work', 'record-evidence', '--work', id, '--task', taskId, '--from', 'evidence.json', '--by', 'evidence-maker', '--expect-revision', String(revision + 1), '--json'));
    writeFileSync(join(root, 'review.json'), JSON.stringify({ checkedCriteria: criteria, findings: [] }));
    return data(run('work', 'review', '--work', id, '--task', taskId, '--from', 'review.json', '--verdict', 'pass', '--by', 'evidence-checker', '--expect-revision', String(revision + 2), '--json'));
  };

  // --- T3.1 amend-task: preview, apply, and no-op handling ---
  planNewWork('amend-task-basic');
  const basicBefore = snapshot('amend-task-basic');
  const changed = { ...tasks[0], title: 'First task clarified' };
  delete changed.id;
  const preview = data(amendTask('amend-task-basic', 'W1', changed, '2', ...withReason(), '--dry-run'));
  assert.equal(preview.dryRun, true);
  assert.equal(preview.definitionRevision, 2);
  assert.deepEqual(preview.invalidatedTaskIds, ['W1']);
  assertUnchanged('amend-task-basic', basicBefore, 'amend-task preview');
  const applied = data(amendTask('amend-task-basic', 'W1', changed, '2', ...withReason()));
  assert.equal(applied.revision, 3);
  assert.equal(applied.definitionRevision, 2);
  assert.equal(applied.status, 'pending');
  assert.deepEqual(applied.invalidatedTaskIds, ['W1']);
  let work = assertValidWork('amend-task-basic', 'amend-task apply');
  assert.equal(work.tasks[0].title, 'First task clarified');
  assert.equal(work.tasks[0].definitionRevision, 2);
  assert.equal(work.tasks[0].evidence, null);
  assert.equal(work.tasks[0].verdict, null);
  assert.equal(work.tasks.map((task) => task.id).join(','), 'W1,W2,W3', 'amendment must preserve task identity and order');
  const lastEvent = work.activity.at(-1);
  assert.equal(lastEvent.event, 'task_amended');
  assert.equal(lastEvent.taskId, 'W1');
  assert.equal(lastEvent.by, 'amend-maker');
  assert.equal(lastEvent.reason, 'Amendment fixture change.');
  const noopBefore = snapshot('amend-task-basic');
  const noop = amendTask('amend-task-basic', 'W1', changed, '3', ...withReason());
  const noopEnvelope = fail(noop, 'INVALID_INPUT');
  assert.match(noopEnvelope.error.message, /matches the current definition/);
  assertUnchanged('amend-task-basic', noopBefore, 'unchanged amendment');
  work = assertValidWork('amend-task-basic', 'rejected no-op');
  assert.equal(work.revision, 3, 'a no-op must not manufacture a new revision or approval');
  assert.equal(work.activity.length, 3, 'a no-op must not append activity');

  // --- T3.1 amend-task: malformed, stale, and unsafe input leaves bytes unchanged ---
  const malformedCases = [
    ['unknown field', { ...changed, unexpected: true }, /only title, description, context/],
    ['missing field', (({ acceptanceCriteria, ...rest }) => rest)(changed), /field acceptanceCriteria is required/],
    ['empty title', { ...changed, title: '   ' }, /title must be a non-empty string/],
    ['unsafe file path', { ...changed, filesToTouch: ['../outside'] }, /safe relative paths/],
    ['duplicate normalized criteria', { ...changed, acceptanceCriteria: ['A check', ' a   CHECK '] }, /duplicate criteria after normalization/],
    ['missing dependency', { ...changed, dependsOn: ['W9'] }, /dependency W9.*does not exist/],
    ['self dependency', { ...changed, dependsOn: ['W1'] }, /self-dependency/],
    ['dependency cycle', { ...changed, dependsOn: ['W2'] }, /dependency cycle/],
  ];
  for (const [name, amendment, expected] of malformedCases) {
    const before = snapshot('amend-task-basic');
    const rejected = amendTask('amend-task-basic', 'W1', amendment, '3', ...withReason());
    const envelope = fail(rejected, 'INVALID_INPUT');
    assert.match(envelope.error.message, expected, `${name} must report a precise error`);
    assertUnchanged('amend-task-basic', before, name);
  }
  for (const [name, extra] of [['missing reason', ['--by', 'amend-maker']], ['missing actor', ['--reason', 'Amendment fixture change.']]]) {
    const before = snapshot('amend-task-basic');
    writeFileSync(join(root, 'amend.json'), JSON.stringify({ ...changed, title: `Attempt ${name}` }));
    const rejected = run('work', 'amend-task', '--work', 'amend-task-basic', '--task', 'W1', '--from', 'amend.json', '--expect-revision', '3', ...extra, '--json');
    fail(rejected, 'INVALID_INPUT');
    assertUnchanged('amend-task-basic', before, name);
  }
  {
    const before = snapshot('amend-task-basic');
    const stale = amendTask('amend-task-basic', 'W1', { ...changed, title: 'Stale attempt' }, '2', ...withReason());
    fail(stale, 'STATE_DIVERGED');
    assertUnchanged('amend-task-basic', before, 'stale revision');
    const unknownTask = amendTask('amend-task-basic', 'W9', changed, '3', ...withReason());
    fail(unknownTask, 'INVALID_INPUT');
    assertUnchanged('amend-task-basic', before, 'unknown task');
  }

  // --- T3.1 amend-task: verified approvals are invalidated with history preserved ---
  planNewWork('amend-task-invalidate');
  verifyTask('amend-task-invalidate', 'W1', 2, ['First output is verified.']);
  verifyTask('amend-task-invalidate', 'W2', 5, ['Second output is verified.']);
  work = assertValidWork('amend-task-invalidate', 'chained passes');
  assert.equal(work.tasks[0].status, 'verified');
  assert.equal(work.tasks[1].status, 'verified');
  const invalidate = data(amendTask('amend-task-invalidate', 'W1', { ...changed, title: 'First task corrected after pass' }, '8', '--reason', 'Correct the definition after verification.', '--by', 'amend-maker', '--json'));
  assert.deepEqual([...invalidate.invalidatedTaskIds].sort(), ['W1', 'W2'], 'downstream verified approvals must be invalidated with the amended task');
  work = assertValidWork('amend-task-invalidate', 'post-amendment invalidation');
  assert.equal(work.tasks[0].status, 'pending');
  assert.equal(work.tasks[0].evidence, null);
  assert.equal(work.tasks[0].verdict, null);
  assert.equal(work.tasks[0].definitionRevision, 2);
  assert.equal(work.tasks[1].status, 'pending', 'a dependent of an unverified prerequisite must not stay verified');
  assert.equal(work.tasks[1].evidence, null);
  assert.equal(work.tasks[1].verdict, null);
  assert.equal(work.handoff.nextTaskId, 'W1');
  const events = work.activity.map((item) => item.event);
  assert(events.includes('review_recorded'), 'a previous pass must remain auditable as historical activity');
  assert.equal(work.activity.at(-1).event, 'task_amended');
  const staleEvidence = run('work', 'record-evidence', '--work', 'amend-task-invalidate', '--task', 'W2', '--from', 'evidence.json', '--by', 'evidence-maker', '--expect-revision', '9', '--json');
  fail(staleEvidence, 'INVALID_INPUT');
  assert.equal(JSON.parse(readFileSync(workPath('amend-task-invalidate'), 'utf8')).revision, 9, 'dependents must wait for an explicit valid amendment path');

  // --- T3.1 amend-task: removed prerequisites recompute eligibility without rewiring ---
  planNewWork('amend-task-prereq');
  const { id: _prereqId, ...prereqAmendment } = tasks[1];
  const prereq = data(amendTask('amend-task-prereq', 'W2', { ...prereqAmendment, dependsOn: [] }, '2', '--reason', 'Drop the prerequisite explicitly.', '--by', 'amend-maker', '--json'));
  assert.equal(prereq.handoff.nextTaskId, 'W1');
  work = assertValidWork('amend-task-prereq', 'removed prerequisite');
  const eligible = data(run('work', 'status', '--work', 'amend-task-prereq', '--task', 'W2', '--json'));
  assert.equal(eligible.task.eligible, true, 'an explicitly unblocked task becomes eligible on its own');
  assert.deepEqual(eligible.task.dependsOn, [], 'dependencies are stored as written, never auto-rewired');

  // --- T3.2 amend-brief: preview, exact copy, and approval invalidation ---
  planNewWork('amend-brief-basic');
  verifyTask('amend-brief-basic', 'W1', 2, ['First output is verified.']);
  work = assertValidWork('amend-brief-basic', 'pre-brief pass');
  const previousDigest = work.brief.digest;
  writeFileSync(join(root, 'brief-v2.md'), '# Amendment fixture revised\n\nValidate CLI-owned task and brief amendments with a revised digest-bound contract.\n');
  const beforeBriefPreview = snapshot('amend-brief-basic');
  const briefPreview = data(run('work', 'amend-brief', '--work', 'amend-brief-basic', '--from', 'brief-v2.md', '--reason', 'Refresh the contract wording.', '--expect-revision', '5', '--by', 'amend-maker', '--dry-run', '--json'));
  assert.equal(briefPreview.dryRun, true);
  assert.notEqual(briefPreview.briefDigest, previousDigest);
  assert.deepEqual(briefPreview.invalidatedTaskIds, ['W1']);
  assertUnchanged('amend-brief-basic', beforeBriefPreview, 'amend-brief preview');
  assert.equal(existsSync(pendingPath('amend-brief-basic')), false, 'preview must not create an intent record');
  const briefApplied = data(run('work', 'amend-brief', '--work', 'amend-brief-basic', '--from', 'brief-v2.md', '--reason', 'Refresh the contract wording.', '--expect-revision', '5', '--by', 'amend-maker', '--json'));
  assert.equal(briefApplied.revision, 6);
  assert.equal(briefApplied.previousDigest, previousDigest);
  assert.deepEqual(briefApplied.invalidatedTaskIds, ['W1']);
  assert.equal(readFileSync(briefPath('amend-brief-basic'), 'utf8'), readFileSync(join(root, 'brief-v2.md'), 'utf8'), 'apply must copy exact source bytes');
  work = assertValidWork('amend-brief-basic', 'amend-brief apply');
  assert.equal(work.brief.digest, briefApplied.briefDigest);
  assert.equal(work.title, 'Amendment fixture revised');
  assert.equal(work.tasks[0].status, 'pending');
  assert.equal(work.tasks[0].evidence, null);
  assert.equal(work.tasks[0].verdict, null);
  const briefEvent = work.activity.at(-1);
  assert.equal(briefEvent.event, 'brief_amended');
  assert.equal(briefEvent.taskId, null);
  assert.equal(briefEvent.reason, 'Refresh the contract wording.', 'activity must carry the reason without embedding the brief');
  assert(!briefEvent.reason.includes('digest-bound contract'), 'activity must not embed brief content or secrets');

  // --- T3.2 amend-brief: failure and retry behavior ---
  {
    const before = snapshot('amend-brief-basic');
    writeFileSync(join(root, 'brief-v3.md'), '# Amendment fixture third version\n\nValidate CLI-owned brief recovery with a third digest-bound contract version.\n');
    const stale = run('work', 'amend-brief', '--work', 'amend-brief-basic', '--from', 'brief-v3.md', '--reason', 'Stale retry.', '--expect-revision', '5', '--by', 'amend-maker', '--json');
    fail(stale, 'STATE_DIVERGED');
    assertUnchanged('amend-brief-basic', before, 'stale brief revision');
    const sameBytes = run('work', 'amend-brief', '--work', 'amend-brief-basic', '--from', 'brief-v2.md', '--reason', 'No change.', '--expect-revision', '6', '--by', 'amend-maker', '--json');
    fail(sameBytes, 'INVALID_INPUT');
    assertUnchanged('amend-brief-basic', before, 'unchanged brief');
    symlinkSync(join(root, 'brief-v3.md'), join(root, 'brief-link.md'));
    const linked = run('work', 'amend-brief', '--work', 'amend-brief-basic', '--from', 'brief-link.md', '--reason', 'Linked source.', '--expect-revision', '6', '--by', 'amend-maker', '--json');
    fail(linked, 'INVALID_INPUT');
    assertUnchanged('amend-brief-basic', before, 'symlink source');
    writeFileSync(join(root, 'brief-big.md'), `# Oversized\n\n${'x'.repeat(1_048_576)}\n`);
    const oversized = run('work', 'amend-brief', '--work', 'amend-brief-basic', '--from', 'brief-big.md', '--reason', 'Oversized.', '--expect-revision', '6', '--by', 'amend-maker', '--json');
    fail(oversized, 'INVALID_INPUT');
    assertUnchanged('amend-brief-basic', before, 'oversized source');
    writeFileSync(join(root, 'growing.md'), '# Growing\n\nAn initially small source.\n');
    const opened = openSync(join(root, 'growing.md'), 'r');
    try {
      assert(fstatSync(opened).size < 1_048_576, 'the descriptor initially fits the source limit');
      appendFileSync(join(root, 'growing.md'), 'x'.repeat(1_048_576));
      assert.throws(() => readBoundedBriefDescriptor(opened), /exceeds the 1 MiB input limit/, 'a file growing after fstat must remain bounded');
    } finally { closeSync(opened); }
    const missing = run('work', 'amend-brief', '--work', 'amend-brief-basic', '--from', 'brief-missing.md', '--reason', 'Missing.', '--expect-revision', '6', '--by', 'amend-maker', '--json');
    fail(missing, 'INVALID_INPUT');
    assertUnchanged('amend-brief-basic', before, 'missing source');
  }
  {
    const before = snapshot('amend-brief-basic');
    writeFileSync(briefPath('amend-brief-basic'), 'changed outside the CLI\n');
    const mismatch = data(run('work', 'status', '--work', 'amend-brief-basic', '--json'));
    assert.equal(mismatch.nextAction, 'resolve_blocker', 'an out-of-band brief edit must surface instead of a false pass');
    writeFileSync(join(root, 'brief-v3.md'), '# Amendment fixture third version\n\nValidate CLI-owned brief recovery with a third digest-bound contract version.\n');
    const tampered = run('work', 'amend-brief', '--work', 'amend-brief-basic', '--from', 'brief-v3.md', '--reason', 'Amend over tampering.', '--expect-revision', '6', '--by', 'amend-maker', '--json');
    fail(tampered, 'STATE_DIVERGED');
    assert.deepEqual(readFileSync(workPath('amend-brief-basic')), before.json, 'an out-of-band edit must never produce a partially accepted contract');
    writeFileSync(briefPath('amend-brief-basic'), before.brief);
  }
  {
    const before = snapshot('amend-brief-basic');
    writeFileSync(join(root, 'brief-v3.md'), '# Amendment fixture third version\n\nValidate CLI-owned brief recovery with a third digest-bound contract version.\n');
    const injected = spawnSync(process.execPath, [cli, 'work', 'amend-brief', '--work', 'amend-brief-basic', '--from', 'brief-v3.md', '--reason', 'Interrupted publication.', '--expect-revision', '6', '--by', 'amend-maker', '--json'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, KYRO_WORK_INJECT_FAILURE: 'amend-brief-after-brief' },
    });
    fail(injected, 'INTERNAL');
    const interrupted = data(run('work', 'status', '--work', 'amend-brief-basic', '--json'));
    assert.equal(interrupted.nextAction, 'resolve_blocker', 'an interrupted publication must read as blocked, never as an approved mixed revision');
    const retried = data(run('work', 'amend-brief', '--work', 'amend-brief-basic', '--from', 'brief-v3.md', '--reason', 'Interrupted publication.', '--expect-revision', '6', '--by', 'amend-maker', '--json'));
    assert.equal(retried.revision, 7);
    assert.equal(readFileSync(briefPath('amend-brief-basic'), 'utf8'), readFileSync(join(root, 'brief-v3.md'), 'utf8'));
    assertValidWork('amend-brief-basic', 'retried publication');
    assert.equal(existsSync(pendingPath('amend-brief-basic')), false, 'successful retry removes durable intent');
    assert.notDeepEqual(readFileSync(workPath('amend-brief-basic')), before.json, 'a recovered publication must advance the Work revision');
  }
  // Replacing the brief with exactly the proposed bytes is not proof of CLI intent.
  {
    planNewWork('manual-replacement');
    const before = snapshot('manual-replacement');
    const proposed = Buffer.from('# Manual replacement\n\nA new outcome must not be silently accepted.\n');
    writeFileSync(join(root, 'manual-source.md'), proposed);
    writeFileSync(briefPath('manual-replacement'), proposed);
    fail(run('work', 'amend-brief', '--work', 'manual-replacement', '--from', 'manual-source.md', '--reason', 'Manual attempt.', '--expect-revision', '2', '--by', 'maker', '--json'), 'STATE_DIVERGED');
    assert.deepEqual(readFileSync(workPath('manual-replacement')), before.json);
    assert.equal(existsSync(pendingPath('manual-replacement')), false);
  }
  // A malformed source cannot be replaced by U+FFFD or produce any state write.
  {
    const before = snapshot('amend-brief-basic');
    writeFileSync(join(root, 'invalid-utf8.md'), Buffer.from([35, 32, 88, 10, 10, 0xff, 10]));
    fail(run('work', 'amend-brief', '--work', 'amend-brief-basic', '--from', 'invalid-utf8.md', '--reason', 'Invalid text.', '--expect-revision', '7', '--by', 'maker', '--json'), 'INVALID_INPUT');
    assertUnchanged('amend-brief-basic', before, 'malformed UTF-8');
    assert.equal(existsSync(pendingPath('amend-brief-basic')), false);
  }
  {
    const bytes = Buffer.from('# Résumé 🌱\r\n\r\nDeliver an exact Unicode and CRLF contract.\r\n');
    writeFileSync(join(root, 'unicode-crlf.md'), bytes);
    const result = data(run('work', 'amend-brief', '--work', 'amend-brief-basic', '--from', 'unicode-crlf.md', '--reason', 'Unicode contract.', '--expect-revision', '7', '--by', 'maker', '--json'));
    assert.deepEqual(readFileSync(briefPath('amend-brief-basic')), bytes);
    assert.equal(result.briefDigest, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(existsSync(pendingPath('amend-brief-basic')), false);
  }
  const interruptedArgs = ['work', 'amend-brief', '--work', 'amend-brief-basic', '--from', 'brief-v4.md', '--reason', 'Recover durable intent.', '--expect-revision', '8', '--by', 'maker', '--json'];
  writeFileSync(join(root, 'brief-v4.md'), '# Fourth brief\n\nDeliver a recoverable contract.\n');
  for (const boundary of ['amend-brief-after-journal', 'amend-brief-before-write', 'amend-brief-after-brief', 'amend-brief-after-work']) {
    const id = `boundary-${boundary.slice(12)}`;
    planNewWork(id);
    const args = interruptedArgs.map((arg, index) => arg === 'amend-brief-basic' ? id : arg === '8' ? '2' : arg);
    const before = snapshot(id);
    const interrupted = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, KYRO_WORK_INJECT_FAILURE: boundary } });
    fail(interrupted, 'INTERNAL');
    assert.equal(existsSync(pendingPath(id)), true, `${boundary} leaves an intent`);
    assert.equal(data(run('work', 'status', '--work', id, '--json')).nextAction, 'resolve_blocker');
    const blockedMutation = run('work', 'start', '--work', id, '--task', 'W1', '--expect-revision', '2', '--json');
    fail(blockedMutation, 'STATE_DIVERGED');
    const conflicting = args.map((arg) => arg === 'Recover durable intent.' ? 'Different reason.' : arg);
    fail(run(...conflicting), 'STATE_DIVERGED');
    if (boundary === 'amend-brief-after-brief') {
      const held = snapshot(id);
      writeFileSync(briefPath(id), Buffer.from('# Foreign edit\n\nThis is not the pending source.\n'));
      fail(run(...args), 'STATE_DIVERGED');
      assert.deepEqual(readFileSync(workPath(id)), held.json, 'conflicting retry cannot publish Work');
      writeFileSync(briefPath(id), held.brief);
    }
    const retried = data(run(...args));
    assert.equal(retried.revision, 3);
    assert.equal(existsSync(pendingPath(id)), false, `${boundary} retry removes intent`);
    assert.notDeepEqual(readFileSync(workPath(id)), before.json);
    assert.deepEqual(readFileSync(briefPath(id)), readFileSync(join(root, 'brief-v4.md')));
  }
  {
    planNewWork('corrupt-intent');
    const args = ['work', 'amend-brief', '--work', 'corrupt-intent', '--from', 'brief-v4.md', '--reason', 'Recover durable intent.', '--expect-revision', '2', '--by', 'maker', '--json'];
    fail(spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, KYRO_WORK_INJECT_FAILURE: 'amend-brief-after-journal' } }), 'INTERNAL');
    const before = snapshot('corrupt-intent');
    writeFileSync(pendingPath('corrupt-intent'), '{broken');
    fail(run(...args), 'STATE_DIVERGED');
    assertUnchanged('corrupt-intent', before, 'corrupt intent');
  }
  forgeSentinels.forEach((path, index) => assert.deepEqual(readFileSync(join(root, path)), forgeBefore[index], `Work amendment must preserve Forge layer ${path}`));
  console.log('Work amend contract fixtures passed.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
